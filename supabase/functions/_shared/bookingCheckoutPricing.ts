export type TicketInventoryItem = {
  id: string;
  name: string;
  price: number;
  onlinePrice: number;
  ageRestriction?: unknown;
};

export type CheckoutPricing = {
  amount: number;
  label: string;
  perParticipant: boolean;
  ticketItems: TicketInventoryItem[];
};

export function resolveTicketInventoryItemIds(ticketSettings: Record<string, unknown>): string[] {
  const direct = Array.isArray(ticketSettings.inventory_item_ids)
    ? ticketSettings.inventory_item_ids
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    : [];
  if (direct.length > 0) return [...new Set(direct)];

  const fromRules = [
    ...(Array.isArray(ticketSettings.assignment_rules) ? ticketSettings.assignment_rules : []),
    ...(Array.isArray(ticketSettings.pricing_rules) ? ticketSettings.pricing_rules : []),
  ]
    .map((rule) => String((rule as { inventory_item_id?: string })?.inventory_item_id || "").trim())
    .filter(Boolean);

  return [...new Set(fromRules)];
}

export function resolveInventoryTicketPrice(item: {
  price?: number | string | null;
  website_online_price?: number | string | null;
}): number {
  const online = Number.parseFloat(String(item.website_online_price ?? ""));
  if (Number.isFinite(online) && online > 0) return online;
  const price = Number.parseFloat(String(item.price ?? 0));
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function resolveCheckoutPricing(
  ticketSettings: Record<string, unknown>,
  isPartyBooking: boolean,
  inventoryRows: Array<{
    id: string;
    name?: string | null;
    price?: number | string | null;
    website_online_price?: number | string | null;
    age_restriction?: unknown;
  }>,
): CheckoutPricing {
  const orderedIds = resolveTicketInventoryItemIds(ticketSettings);
  const byId = new Map(inventoryRows.map((row) => [row.id, row]));
  const ticketItems: TicketInventoryItem[] = orderedIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => {
      const onlinePrice = resolveInventoryTicketPrice(row);
      const price = Number.parseFloat(String(row.price ?? 0)) || 0;
      return {
        id: row.id,
        name: String(row.name || "Ticket").trim(),
        price: Number.isFinite(price) && price > 0 ? price : onlinePrice,
        onlinePrice,
        ageRestriction: row.age_restriction ?? null,
      };
    })
    .filter((item) => item.onlinePrice > 0 || item.price > 0);

  if (ticketItems.length > 0) {
    if (isPartyBooking) {
      const item = ticketItems[0];
      return {
        amount: item.onlinePrice > 0 ? item.onlinePrice : item.price,
        label: item.name,
        perParticipant: false,
        ticketItems,
      };
    }

    const unitPrices = ticketItems.map((item) =>
      item.onlinePrice > 0 ? item.onlinePrice : item.price,
    );
    const amount = Math.min(...unitPrices);
    return {
      amount,
      label: ticketItems.length === 1 ? ticketItems[0].name : "Tickets",
      perParticipant: true,
      ticketItems,
    };
  }

  const tickets = ticketSettings.tickets;
  if (Array.isArray(tickets) && tickets.length > 0) {
    const first = tickets[0] as Record<string, unknown>;
    const price = Number(first.price ?? first.gatePrice ?? 0);
    if (price > 0) {
      return {
        amount: price,
        label: String(first.name || (isPartyBooking ? "Party package" : "Ticket")),
        perParticipant: !isPartyBooking,
        ticketItems: [],
      };
    }
  }

  const online = Number(ticketSettings.online_price ?? ticketSettings.basePrice ?? 0);
  if (online > 0) {
    return {
      amount: online,
      label: isPartyBooking ? "Party package" : "Tickets",
      perParticipant: !isPartyBooking,
      ticketItems: [],
    };
  }

  return {
    amount: 0,
    label: isPartyBooking ? "Party package" : "Tickets",
    perParticipant: !isPartyBooking,
    ticketItems: [],
  };
}
