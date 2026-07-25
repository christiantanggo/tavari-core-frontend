import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { usePermissions } from '../../hooks/usePermissions';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

function moneyFmt(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function GiftCardsListScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifyPurchaser, setVerifyPurchaser] = useState(false);
  const [lookupCode, setLookupCode] = useState('');

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const rows = await GiftCardService.listCards(selectedBusinessId, { search });
      setCards(rows);
    } catch (err) {
      toast.error(err.message || 'Failed to load cards');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, search]);

  useEffect(() => {
    load();
  }, [load]);

  const openCard = async (card) => {
    setSelected(card);
    setVerifyPurchaser(false);
    try {
      const txs = await GiftCardService.listTransactions(selectedBusinessId, { giftCardId: card.id });
      setHistory(txs);
    } catch {
      setHistory([]);
    }
  };

  const handleLookup = async () => {
    try {
      const card = await GiftCardService.lookupCard(selectedBusinessId, lookupCode);
      if (!card) {
        toast.error('Gift card not found');
        return;
      }
      if (['voided', 'replaced', 'expired'].includes(card.status)) {
        toast.error(card.invalid_reason || `This gift card is ${card.status}.`);
      }
      await openCard(card);
    } catch (err) {
      toast.error(err.message || 'Lookup failed');
    }
  };

  const handleReprint = async () => {
    if (!selected) return;
    if (!window.confirm('Reprint this card? The old code and QR will be invalidated permanently.')) return;
    try {
      const replacement = await GiftCardService.reprintGiftCard({
        businessId: selectedBusinessId,
        giftCardId: selected.id,
        verifiedOriginalPurchaser: verifyPurchaser,
        processedByUserId: userId || null,
      });
      toast.success(`Reprinted as ${replacement.code}`);
      setVerifyPurchaser(false);
      await load();
      await openCard(replacement);
    } catch (err) {
      toast.error(err.message || 'Reprint failed');
    }
  };

  const handleVoid = async () => {
    if (!selected) return;
    const reason = window.prompt('Void reason (shown if old code is scanned):', 'Voided by staff');
    if (reason == null) return;
    try {
      await GiftCardService.voidGiftCard({
        businessId: selectedBusinessId,
        giftCardId: selected.id,
        reason,
        processedByUserId: userId || null,
      });
      toast.success('Gift card voided');
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err.message || 'Void failed');
    }
  };

  return (
    <div>
      <div style={{ ...s.panel, ...s.row }}>
        <input
          style={s.input}
          placeholder="Search code, name, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" style={s.buttonSecondary} onClick={load}>Search</button>
        <input
          style={s.input}
          placeholder="Scan / enter code"
          value={lookupCode}
          onChange={(e) => setLookupCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
        />
        <button type="button" style={s.button} onClick={handleLookup}>Lookup</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.2fr 1fr' : '1fr', gap: 16 }}>
        <div style={s.panel}>
          {loading ? (
            <div style={s.empty}>Loading…</div>
          ) : cards.length === 0 ? (
            <div style={s.empty}>No gift cards yet. Issue one from Sell / Issue.</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Code</th>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Balance</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Purchaser</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.id} style={{ cursor: 'pointer' }} onClick={() => openCard(card)}>
                    <td style={s.td}><strong>{card.code}</strong></td>
                    <td style={s.td}>{card.card_type}</td>
                    <td style={s.td}>
                      {card.card_type === 'money'
                        ? moneyFmt(card.balance_remaining)
                        : `${card.inventory_qty_remaining} left`}
                    </td>
                    <td style={s.td}><span style={s.badge}>{card.status}</span></td>
                    <td style={s.td}>{card.purchaser_name || card.purchaser_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div style={s.panel}>
            <h3 style={{ marginTop: 0 }}>{selected.code}</h3>
            <p style={s.muted}>QR: {selected.qr_payload}</p>
            <div style={s.grid2}>
              <div><div style={s.label}>Status</div><div>{selected.status}</div></div>
              <div><div style={s.label}>Balance</div><div>{moneyFmt(selected.balance_remaining)}</div></div>
              <div><div style={s.label}>Face value</div><div>{moneyFmt(selected.face_value)}</div></div>
              <div><div style={s.label}>Amount paid</div><div>{moneyFmt(selected.amount_paid)}</div></div>
              <div><div style={s.label}>Purchaser</div><div>{selected.purchaser_name || selected.purchaser_email || '—'}</div></div>
              <div><div style={s.label}>Recipient</div><div>{selected.recipient_name || selected.recipient_email || '—'}</div></div>
            </div>

            {selected.invalid_reason && (
              <div style={{ ...s.warning, marginTop: 12 }}>{selected.invalid_reason}</div>
            )}

            <div style={{ ...s.warning, marginTop: 16 }}>
              Before reprinting, staff must call or verify the original purchaser.
            </div>
            <TavariCheckbox
              id="verify-purchaser-reprint"
              checked={verifyPurchaser}
              onChange={setVerifyPurchaser}
              label="I verified this is the original purchaser"
            />

            <div style={{ ...s.row, marginTop: 16 }}>
              <button type="button" style={s.button} onClick={handleReprint}>Reprint</button>
              <button type="button" style={s.buttonDanger} onClick={handleVoid}>Void</button>
              <button type="button" style={s.buttonSecondary} onClick={() => setSelected(null)}>Close</button>
            </div>

            <h4 style={{ marginTop: 24 }}>Audit history</h4>
            {history.length === 0 ? (
              <p style={s.muted}>No transactions yet.</p>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>When</th>
                    <th style={s.th}>Type</th>
                    <th style={s.th}>Amount</th>
                    <th style={s.th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((tx) => (
                    <tr key={tx.id}>
                      <td style={s.td}>{new Date(tx.created_at).toLocaleString()}</td>
                      <td style={s.td}>{tx.transaction_type}</td>
                      <td style={s.td}>{moneyFmt(tx.amount)}</td>
                      <td style={s.td}>{tx.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
