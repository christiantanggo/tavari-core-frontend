// supabase/functions/vending-machine-api/index.ts
// Supabase Edge Function for Vending Machine API integration

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  aggregateProductsFromSlots,
  extractInventoryArrayFromDeviceDetail,
  extractInventoryFromTerminalStock,
  flattenTerminalGoodsItems,
  generateSignature,
  getVendingCredentials,
  makeVendingAPIRequest,
  matchTerminalGoodsId,
  mergeSlotRows,
  normalizeSlotRow,
  resolveDevNo,
  terminalBind,
  terminalGetGoodsData,
  terminalGetStockData,
} from "../_shared/vendingYishouyun.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VendingMachineRequest {
  action: string;
  deviceId?: string;
  goodsId?: string;
  orderNo?: string;
  totalFee?: number;
  goodsItems?: Array<{
    orderNo: string;
    goodsId: string;
    goodsName: string;
    price: string;
  }>;
  notifyUrl?: string;
  sevNo?: string;
  row?: number;
  col?: number;
  maxNum?: number;
  num?: number;
  goodsName?: string;
  goodsSn?: string;
  picUrl?: string;
  comePrice?: string;
  price?: string;
  vipPrice?: string;
  usage?: string;
  existingGoodsId?: string;
  devNo?: string;
  [key: string]: unknown;
}

async function getTerminalToken(deviceId: string, devNoOverride?: string) {
  const credentials = await getVendingCredentials();
  const devNo = String(devNoOverride ?? "").trim() || await resolveDevNo(deviceId, credentials);
  const { token } = await terminalBind(devNo, credentials);
  return { token, devNo, credentials };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const credentials = await getVendingCredentials();
    const body: VendingMachineRequest = await req.json();
    const { action, ...params } = body;

    let result: Record<string, unknown>;

    switch (action) {
      case "checkMachineOnline":
        result = await makeVendingAPIRequest(
          "/check_dev_online",
          "GET",
          { device_id: params.deviceId },
          credentials,
        );
        break;

      case "checkCanOrder":
        result = await makeVendingAPIRequest(
          "/check_dev_state",
          "GET",
          { device_id: params.deviceId, goods_id: params.goodsId },
          credentials,
        );
        break;

      case "getDeviceDetails":
        result = await makeVendingAPIRequest(
          "/device_detail",
          "POST",
          { device_id: params.deviceId },
          credentials,
        );
        break;

      case "getMergedInventory": {
        const deviceId = String(params.deviceId ?? "").trim();
        const cloudDetail = await makeVendingAPIRequest(
          "/device_detail",
          "POST",
          { device_id: deviceId },
          credentials,
        );
        const rawData = (cloudDetail?.data ?? cloudDetail) as Record<string, unknown>;
        const cloudInventory = extractInventoryArrayFromDeviceDetail(rawData).map((row, idx) =>
          normalizeSlotRow(row, idx)
        );

        let terminalInventory: ReturnType<typeof normalizeSlotRow>[] = [];
        let terminalError: string | null = null;
        try {
          const { token } = await getTerminalToken(deviceId, String(params.devNo ?? ""));
          const stockHit = await terminalGetStockData(token, credentials);
          if (stockHit) {
            terminalInventory = extractInventoryFromTerminalStock(stockHit.payload).map((row, idx) =>
              normalizeSlotRow(row, idx)
            );
          }
        } catch (e) {
          terminalError = e instanceof Error ? e.message : String(e);
        }

        const vendorRows = mergeSlotRows(cloudInventory, []);
        const withTerminal = mergeSlotRows(
          terminalInventory.length ? terminalInventory : cloudInventory,
          [],
        );
        const mergedVendor = mergeSlotRows(withTerminal, []);
        const products = aggregateProductsFromSlots(mergedVendor);

        result = {
          err: 0,
          msg: "OK",
          data: {
            devNo: rawData?.dev_no ?? rawData?.devNo ?? null,
            cloudInventory,
            terminalInventory,
            mergedSlots: mergedVendor,
            products,
            terminalError,
          },
        };
        break;
      }

      case "getTerminalGoodsList": {
        const deviceId = String(params.deviceId ?? "").trim();
        const { token, devNo } = await getTerminalToken(deviceId, String(params.devNo ?? ""));
        const goodsPayload = await terminalGetGoodsData(token, credentials);
        const items = flattenTerminalGoodsItems(goodsPayload);
        result = {
          err: 0,
          msg: "OK",
          data: { devNo, items, raw: goodsPayload },
        };
        break;
      }

      case "resolveGoodsIdAfterSync": {
        const deviceId = String(params.deviceId ?? "").trim();
        let goodsId = "";
        let terminalError: string | null = null;

        try {
          const { token } = await getTerminalToken(deviceId, String(params.devNo ?? ""));
          const goodsPayload = await terminalGetGoodsData(token, credentials);
          const items = flattenTerminalGoodsItems(goodsPayload);
          goodsId = matchTerminalGoodsId(items, {
            goodsSn: String(params.goodsSn ?? ""),
            goodsName: String(params.goodsName ?? ""),
          });
        } catch (e) {
          terminalError = e instanceof Error ? e.message : String(e);
        }

        result = {
          err: 0,
          msg: goodsId ? "OK" : terminalError || "No goods_id match",
          data: { goodsId, terminalError },
        };
        break;
      }

      case "createOrder":
        result = await makeVendingAPIRequest(
          "/order_build",
          "GET",
          {
            device_id: params.deviceId,
            goods_id: params.goodsId,
            order_no: params.orderNo,
          },
          credentials,
        );
        break;

      case "createOrderWithPayment":
        result = await makeVendingAPIRequest(
          "/build_order",
          "POST",
          {
            device_id: params.deviceId,
            order_no: params.orderNo,
            total_fee: params.totalFee,
            goods_items: JSON.stringify(params.goodsItems),
            notify_url: params.notifyUrl,
          },
          credentials,
        );
        break;

      case "saveInventory":
        result = await makeVendingAPIRequest(
          "/save_stock",
          "POST",
          {
            device_id: params.deviceId,
            sev_no: params.sevNo,
            row: params.row,
            col: params.col,
            goods_id: params.goodsId,
            max_num: params.maxNum,
            num: params.num,
          },
          credentials,
        );
        break;

      case "fillInventory":
        result = await makeVendingAPIRequest(
          "/fill_stock",
          "POST",
          {
            device_id: params.deviceId,
            sev_no: params.sevNo,
            row: params.row,
            col: params.col,
            goods_id: params.goodsId,
            max_num: params.maxNum,
            num: params.num,
          },
          credentials,
        );
        break;

      case "fillAllInventory":
        result = await makeVendingAPIRequest(
          "/up_all_stock",
          "POST",
          { device_id: params.deviceId, sev_no: params.sevNo },
          credentials,
        );
        break;

      case "removeInventory":
        result = await makeVendingAPIRequest(
          "/remove_stock",
          "POST",
          {
            device_id: params.deviceId,
            sev_no: params.sevNo,
            row: params.row,
            col: params.col,
          },
          credentials,
        );
        break;

      case "downAllInventory":
        result = await makeVendingAPIRequest(
          "/down_all_stock",
          "POST",
          { device_id: params.deviceId, sev_no: params.sevNo },
          credentials,
        );
        break;

      case "syncProduct": {
        const goodsSnIn = String(params.goodsSn ?? "").trim();
        const picIn = String(params.picUrl ?? "").trim();
        const goods_sn = goodsSnIn ||
          `AUTO-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`}`.slice(
            0,
            120,
          );
        const pic_url = picIn || "https://placehold.co/96x96/e5e7eb/9ca3af/png?text=%20";
        const existingId = String(params.existingGoodsId ?? "").trim();
        result = await makeVendingAPIRequest(
          "/sync_goods",
          "POST",
          {
            goods_name: params.goodsName,
            goods_sn,
            pic_url,
            come_price: params.comePrice || "0",
            price: params.price,
            vip_price: params.vipPrice || params.price,
            usage: params.usage || "",
            ...(existingId ? { goods_id: existingId } : {}),
          },
          credentials,
        );

        if (typeof result.err === "number" && result.err === 0 && params.deviceId) {
          try {
            const { token } = await getTerminalToken(
              String(params.deviceId),
              String(params.devNo ?? ""),
            );
            const goodsPayload = await terminalGetGoodsData(token, credentials);
            const items = flattenTerminalGoodsItems(goodsPayload);
            const resolved = matchTerminalGoodsId(items, {
              goodsSn: goods_sn,
              goodsName: String(params.goodsName ?? ""),
            });
            if (resolved) {
              result = {
                ...result,
                data: {
                  ...(typeof result.data === "object" && result.data ? result.data as object : {}),
                  goods_id: resolved,
                  goodsId: resolved,
                },
              };
            }
          } catch {
            /* sync still succeeded; goods_id may be resolved client-side */
          }
        }
        break;
      }

      case "getRecentSales":
        result = await makeVendingAPIRequest("/get_order_list", "GET", {}, credentials);
        break;

      case "testRemoteChannel":
        result = await makeVendingAPIRequest(
          "/test_sev",
          "POST",
          {
            device_id: params.deviceId,
            sev_no: params.sevNo,
            row: params.row,
            col: params.col,
          },
          credentials,
        );
        break;

      case "handlePaymentCallback": {
        const { sign, ...dataToVerify } = params as Record<string, unknown>;
        const expectedSign = generateSignature(dataToVerify, credentials.apiKey);
        if (sign !== expectedSign) {
          return new Response(
            JSON.stringify({ err: 1, msg: "Invalid signature" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = { err: 0, msg: "OK" };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Vending Machine API Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
