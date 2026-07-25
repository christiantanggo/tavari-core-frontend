import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FiMinus, FiPlus, FiShoppingCart } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';
import SelfServeHelcimQrPayment from '../../components/Kiosk/SelfServeHelcimQrPayment';
import './SelfServeKiosk.css';

function money(n, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format(
      Number(n),
    );
  } catch {
    return `${Number(n).toFixed(2)} ${currency}`;
  }
}

export default function SelfServePayKioskScreen() {
  const { businessId } = useParams();
  const [searchParams] = useSearchParams();
  const currency = searchParams.get('currency') || 'CAD';

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [search, setSearch] = useState('');

  /** @type {Array<{ inventoryId: string, name: string, price: number, quantity: number, image_url?: string | null, track_stock?: boolean, stock_quantity?: number | null }>} */
  const [cart, setCart] = useState([]);

  const [cartOpen, setCartOpen] = useState(false);
  const [phase, setPhase] = useState('shop');
  /** shop | review | pay */

  const loadCatalog = useCallback(async () => {
    if (!businessId) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const { data, error } = await supabase.functions.invoke('self-serve-kiosk-catalog', {
        body: { businessId },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      setCategories(data?.categories || []);
      setProducts(data?.products || []);
    } catch (e) {
      console.error(e);
      const msg = e?.message || 'Could not load menu';
      setCatalogError(msg);
      toast.error(msg);
    } finally {
      setCatalogLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (activeCategoryId) {
      list = list
        .filter((p) => p.category_id === activeCategoryId)
        .sort((a, b) => {
          const ao = Number(a.category_sort_order ?? 0);
          const bo = Number(b.category_sort_order ?? 0);
          if (ao !== bo) return ao - bo;
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          String(p.name || '')
            .toLowerCase()
            .includes(q) || String(p.sku || '')
            .toLowerCase()
            .includes(q),
      );
    }
    return list;
  }, [products, activeCategoryId, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0),
    [cart],
  );

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.quantity, 0), [cart]);

  const helcimLabel = useMemo(() => {
    const s = cart.map((l) => `${l.quantity}× ${l.name}`).join(', ');
    return s.length > 240 ? `${s.slice(0, 237)}…` : s;
  }, [cart]);

  const maxQtyForLine = (line) => {
    if (!line.track_stock) return 999;
    const sq = line.stock_quantity;
    if (sq == null || !Number.isFinite(Number(sq))) return 999;
    return Math.max(0, Math.floor(Number(sq)));
  };

  const addProduct = (p) => {
    const hasMods =
      p.modifier_group_ids &&
      (Array.isArray(p.modifier_group_ids) ? p.modifier_group_ids.length > 0 : Object.keys(p.modifier_group_ids).length > 0);
    if (hasMods) {
      toast('This item has options. Ask staff to add it on the register.', { icon: 'ℹ️' });
    }

    const price = Number(p.price);
    if (!Number.isFinite(price)) return;

    if (p.track_stock) {
      const sq = p.stock_quantity != null ? Number(p.stock_quantity) : 0;
      if (sq <= 0) {
        toast.error('Sold out');
        return;
      }
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.inventoryId === p.id);
      if (idx >= 0) {
        const line = prev[idx];
        const maxQ = maxQtyForLine(line);
        if (line.quantity >= maxQ) {
          toast.error('No more stock for this item');
          return prev;
        }
        return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      }

      if (p.track_stock) {
        const sq = Number(p.stock_quantity);
        if (sq < 1) return prev;
      }

      return [
        ...prev,
        {
          inventoryId: p.id,
          name: p.name,
          price,
          quantity: 1,
          image_url: p.image_url,
          track_stock: !!p.track_stock,
          stock_quantity: p.stock_quantity != null ? Number(p.stock_quantity) : null,
        },
      ];
    });
  };

  const updateLineQty = (inventoryId, delta) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.inventoryId === inventoryId);
      if (idx < 0) return prev;
      const line = prev[idx];
      const maxQ = maxQtyForLine(line);
      const nextQty = line.quantity + delta;
      if (nextQty <= 0) {
        return prev.filter((l) => l.inventoryId !== inventoryId);
      }
      if (nextQty > maxQ) {
        toast.error('Maximum available quantity reached');
        return prev;
      }
      return prev.map((l, i) => (i === idx ? { ...l, quantity: nextQty } : l));
    });
  };

  const clearCart = () => setCart([]);

  if (!businessId) {
    return (
      <div className="self-serve-kiosk self-serve-kiosk--error">
        <p>Missing business in the URL. Use /kiosk/self-serve-pay/&lt;businessId&gt;</p>
      </div>
    );
  }

  if (phase === 'pay') {
    return (
      <SelfServeHelcimQrPayment
        businessId={businessId}
        currency={currency}
        checkoutAmount={Number(cartTotal.toFixed(2))}
        checkoutLabel={helcimLabel}
        onCancelCheckout={() => setPhase('review')}
        onPaymentComplete={() => {
          clearCart();
          setPhase('shop');
          setCartOpen(false);
        }}
      />
    );
  }

  return (
    <div className="self-serve-kiosk">
      <header className="self-serve-kiosk__header">
        <div className="self-serve-kiosk__brand">
          <h1 className="self-serve-kiosk__title">Order here</h1>
          <p className="self-serve-kiosk__tagline">Tap items to add · Review your bag · Pay with your phone</p>
        </div>
        {phase === 'review' ? (
          <button type="button" className="self-serve-kiosk__header-btn" onClick={() => setPhase('shop')}>
            ← Back to menu
          </button>
        ) : null}
      </header>

      {phase === 'review' ? (
        <div className="self-serve-kiosk__review">
          <h2 className="self-serve-kiosk__review-title">Your order</h2>
          <ul className="self-serve-kiosk__review-list">
            {cart.map((line) => (
              <li key={line.inventoryId} className="self-serve-kiosk__review-row">
                <span className="self-serve-kiosk__review-qty">{line.quantity}×</span>
                <span className="self-serve-kiosk__review-name">{line.name}</span>
                <span className="self-serve-kiosk__review-price">
                  {money(line.price * line.quantity, currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="self-serve-kiosk__review-total">
            <span>Total</span>
            <strong>{money(cartTotal, currency)}</strong>
          </div>
          <div className="self-serve-kiosk__review-actions">
            <button type="button" className="self-serve-kiosk__btn secondary" onClick={() => setPhase('shop')}>
              Add more items
            </button>
            <button
              type="button"
              className="self-serve-kiosk__btn primary"
              disabled={cart.length === 0 || cartTotal <= 0}
              onClick={() => setPhase('pay')}
            >
              Pay with phone (QR)
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="self-serve-kiosk__toolbar">
            <input
              className="self-serve-kiosk__search"
              type="search"
              placeholder="Search menu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search menu"
            />
          </div>

          <div className="self-serve-kiosk__categories">
            <button
              type="button"
              className={`self-serve-kiosk__chip ${activeCategoryId == null ? 'active' : ''}`}
              onClick={() => setActiveCategoryId(null)}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`self-serve-kiosk__chip ${activeCategoryId === c.id ? 'active' : ''}`}
                onClick={() => setActiveCategoryId(c.id)}
              >
                {c.emoji ? <span className="self-serve-kiosk__chip-emoji">{c.emoji}</span> : null}
                {c.name}
              </button>
            ))}
          </div>

          <main className="self-serve-kiosk__main">
            {catalogLoading ? (
              <p className="self-serve-kiosk__loading">Loading menu…</p>
            ) : catalogError ? (
              <p className="self-serve-kiosk__err">{catalogError}</p>
            ) : filteredProducts.length === 0 ? (
              <p className="self-serve-kiosk__empty">No items match your search.</p>
            ) : (
              <div className="self-serve-kiosk__grid">
                {filteredProducts.map((p) => {
                  const soldOut = p.track_stock && Number(p.stock_quantity) <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`self-serve-kiosk__tile ${soldOut ? 'sold-out' : ''}`}
                      onClick={() => !soldOut && addProduct(p)}
                      disabled={soldOut}
                    >
                      <div className="self-serve-kiosk__tile-img-wrap">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="self-serve-kiosk__tile-img" />
                        ) : (
                          <div className="self-serve-kiosk__tile-placeholder" aria-hidden />
                        )}
                        {soldOut ? <span className="self-serve-kiosk__sold-badge">Sold out</span> : null}
                      </div>
                      <div className="self-serve-kiosk__tile-meta">
                        <span className="self-serve-kiosk__tile-name">{p.name}</span>
                        <span className="self-serve-kiosk__tile-price">{money(p.price, currency)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </main>

          <div className="self-serve-kiosk__dock">
            <button
              type="button"
              className="self-serve-kiosk__dock-btn"
              onClick={() => setCartOpen(true)}
              disabled={cartCount === 0}
            >
              <FiShoppingCart size={22} />
              <span className="self-serve-kiosk__dock-label">
                {cartCount === 0 ? 'Bag' : `${cartCount} ${cartCount === 1 ? 'item' : 'items'} · ${money(cartTotal, currency)}`}
              </span>
            </button>
            <button
              type="button"
              className="self-serve-kiosk__dock-checkout"
              disabled={cart.length === 0}
              onClick={() => setPhase('review')}
            >
              Checkout
            </button>
          </div>

          {cartOpen ? (
            <div
              className="self-serve-kiosk__overlay"
              role="dialog"
              aria-modal
              aria-labelledby="bag-title"
              onClick={() => setCartOpen(false)}
            >
              <div className="self-serve-kiosk__sheet" onClick={(e) => e.stopPropagation()}>
                <div className="self-serve-kiosk__sheet-head">
                  <h2 id="bag-title" className="self-serve-kiosk__sheet-title">
                    Your bag
                  </h2>
                  <button type="button" className="self-serve-kiosk__sheet-close" onClick={() => setCartOpen(false)}>
                    Done
                  </button>
                </div>
                {cart.length === 0 ? (
                  <p className="self-serve-kiosk__sheet-empty">Your bag is empty.</p>
                ) : (
                  <ul className="self-serve-kiosk__sheet-lines">
                    {cart.map((line) => (
                      <li key={line.inventoryId} className="self-serve-kiosk__sheet-line">
                        <div className="self-serve-kiosk__sheet-line-info">
                          <span className="self-serve-kiosk__sheet-line-name">{line.name}</span>
                          <span className="self-serve-kiosk__sheet-line-each">
                            {money(line.price, currency)} each
                          </span>
                        </div>
                        <div className="self-serve-kiosk__sheet-line-actions">
                          <button
                            type="button"
                            className="self-serve-kiosk__qty-btn"
                            aria-label="Decrease"
                            onClick={() => updateLineQty(line.inventoryId, -1)}
                          >
                            <FiMinus />
                          </button>
                          <span className="self-serve-kiosk__qty-val">{line.quantity}</span>
                          <button
                            type="button"
                            className="self-serve-kiosk__qty-btn"
                            aria-label="Increase"
                            onClick={() => updateLineQty(line.inventoryId, 1)}
                          >
                            <FiPlus />
                          </button>
                          <span className="self-serve-kiosk__sheet-line-sub">
                            {money(line.price * line.quantity, currency)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="self-serve-kiosk__sheet-footer">
                  <span>Subtotal</span>
                  <strong>{money(cartTotal, currency)}</strong>
                </div>
                <button
                  type="button"
                  className="self-serve-kiosk__btn primary block"
                  disabled={cart.length === 0}
                  onClick={() => {
                    setCartOpen(false);
                    setPhase('review');
                  }}
                >
                  Review order
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
