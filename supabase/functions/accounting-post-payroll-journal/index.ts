// Posts payroll summary as a Journal Entry to ERPNext. Call from HR after generating deduction report.
// POST body: { business_id, posting_date, total_gross_pay, total_net_pay, employee_federal_tax, employee_provincial_tax, employee_ei, employee_cpp, employer_ei, employer_cpp }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchAccountNamesForCompany, resolveLedgerAccount } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      posting_date?: string;
      total_gross_pay?: number;
      total_net_pay?: number;
      employee_federal_tax?: number;
      employee_provincial_tax?: number;
      employee_ei?: number;
      employee_cpp?: number;
      employer_ei?: number;
      employer_cpp?: number;
    };
    const businessId = body?.business_id;
    const postingDate = body?.posting_date?.slice(0, 10);
    const totalGross = Number(body?.total_gross_pay) || 0;
    const totalNet = Number(body?.total_net_pay) || 0;
    const empFederal = Number(body?.employee_federal_tax) || 0;
    const empProvincial = Number(body?.employee_provincial_tax) || 0;
    const empEi = Number(body?.employee_ei) || 0;
    const empCpp = Number(body?.employee_cpp) || 0;
    const empEiCo = Number(body?.employer_ei) || 0;
    const empCppCo = Number(body?.employer_cpp) || 0;

    if (!businessId || !postingDate) return json({ error: 'Missing business_id or posting_date' });
    if (totalGross <= 0) return json({ error: 'total_gross_pay must be positive' });

    const totalEmployeeDeductions = empFederal + empProvincial + empEi + empCpp;
    const totalRemittance = totalEmployeeDeductions + empEiCo + empCppCo;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const netPayDifference = Math.abs(round2(totalGross - totalEmployeeDeductions - totalNet));
    if (netPayDifference > 0.02) {
      return json({
        error: 'Payroll totals do not balance. Gross pay must equal net pay plus employee deductions before posting.'
      });
    }
    const journalDebitTotal = round2(totalGross + empEiCo + empCppCo);
    const journalCreditTotal = round2(totalRemittance + totalNet);
    if (Math.abs(journalDebitTotal - journalCreditTotal) > 0.02) {
      return json({
        error: 'Payroll journal does not balance. Verify gross pay, net pay, and payroll deductions before posting.'
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    const userId = user?.id;
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('user_id, role')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .in('role', ['owner', 'manager', 'admin'])
      .limit(1)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until, salary_expense_account_erpnext, employer_cpp_expense_account_erpnext, employer_ei_expense_account_erpnext, payroll_liability_account_erpnext, payroll_bank_account_erpnext')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found' });

    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(postingDate).getTime();
      if (postDate <= lockedUntil) return json({ error: 'Posting date is in a locked period.' });
    }

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    if (!baseUrl || !apiKey) return json({ error: 'ERPNext URL and API Key required in Accounting → Settings' });

    const accRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accRes.ok || !accRes.accounts?.length) return json({ error: accRes.error || 'Could not load accounts' });

    const salaryAccount = resolveLedgerAccount(accRes.accounts, (config.salary_expense_account_erpnext as string) || '', ['Salary', 'Salaries', 'Wages', 'Salary Expense']);
    if (!salaryAccount) return json({ error: 'Set Salary expense account in Accounting → Settings (payroll accounts).' });

    const liabilityAccount = resolveLedgerAccount(accRes.accounts, (config.payroll_liability_account_erpnext as string) || '', ['Payroll Liabilities', 'Payroll Deductions Payable', 'CRA Payable']);
    if (!liabilityAccount) return json({ error: 'Set Payroll liability account in Accounting → Settings.' });

    const bankAccount = resolveLedgerAccount(accRes.accounts, (config.payroll_bank_account_erpnext as string) || '', ['Bank', 'Cash', 'Payroll Bank']);
    if (!bankAccount) return json({ error: 'Set Payroll bank account in Accounting → Settings.' });

    const employerCppAccount = (config.employer_cpp_expense_account_erpnext as string)?.trim()
      ? resolveLedgerAccount(accRes.accounts, config.employer_cpp_expense_account_erpnext as string, [])
      : salaryAccount;
    const employerEiAccount = (config.employer_ei_expense_account_erpnext as string)?.trim()
      ? resolveLedgerAccount(accRes.accounts, config.employer_ei_expense_account_erpnext as string, [])
      : salaryAccount;

    const accountsPayload: { account: string; debit_in_account_currency: number; credit_in_account_currency: number }[] = [];

    accountsPayload.push({ account: salaryAccount, debit_in_account_currency: round2(totalGross), credit_in_account_currency: 0 });
    if (empCppCo > 0 && employerCppAccount) accountsPayload.push({ account: employerCppAccount, debit_in_account_currency: round2(empCppCo), credit_in_account_currency: 0 });
    if (empEiCo > 0 && employerEiAccount) accountsPayload.push({ account: employerEiAccount, debit_in_account_currency: round2(empEiCo), credit_in_account_currency: 0 });
    if (totalRemittance > 0) accountsPayload.push({ account: liabilityAccount, debit_in_account_currency: 0, credit_in_account_currency: round2(totalRemittance) });
    accountsPayload.push({ account: bankAccount, debit_in_account_currency: 0, credit_in_account_currency: round2(totalNet) });

    const payloadDebitTotal = round2(accountsPayload.reduce((sum, row) => sum + row.debit_in_account_currency, 0));
    const payloadCreditTotal = round2(accountsPayload.reduce((sum, row) => sum + row.credit_in_account_currency, 0));
    if (Math.abs(payloadDebitTotal - payloadCreditTotal) > 0.02) {
      return json({ error: 'Payroll journal lines do not balance after account allocation. Review the payroll totals and configured accounts.' });
    }

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: postingDate,
      company,
      voucher_type: 'Journal Entry',
      user_remark: `Payroll journal – gross ${totalGross.toFixed(2)}, net ${totalNet.toFixed(2)}`,
      accounts: accountsPayload
    };

    const createResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Journal Entry', jePayload);
    if (!createResult.ok) return json({ error: createResult.error || 'ERPNext request failed' });

    const jeData = createResult.data as Record<string, unknown> | undefined;
    const jeName = (jeData?.data as Record<string, string>)?.name ?? (jeData as Record<string, string>)?.name;
    if (!jeName) return json({ error: 'Journal Entry created but no name returned' });

    const fetchRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Journal Entry/${encodeURIComponent(jeName)}`);
    const docToSubmit = fetchRes.ok && (fetchRes.data as { data?: Record<string, unknown> })?.data
      ? (fetchRes.data as { data: Record<string, unknown> }).data
      : { doctype: 'Journal Entry', name: jeName };

    const submitResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc: docToSubmit });
    if (!submitResult.ok) return json({ error: `Journal Entry created but submit failed: ${submitResult.error || 'unknown'}` });

    return json({ success: true, erpnext_journal_entry_id: jeName });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
