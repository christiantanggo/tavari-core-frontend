import dayjs from 'https://esm.sh/dayjs@1.11.10'
import utc from 'https://esm.sh/dayjs@1.11.10/plugin/utc'
import timezone from 'https://esm.sh/dayjs@1.11.10/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export type LaborSubsidyConfig = {
  enabled: boolean
  partner: string | null
  wageCap: number
  maxHoursPerWeek: number
  startDate: string | null
  endDate: string | null
}

export type ClockLaborRow = {
  employeeId: string
  clockInIso: string
  paidMinutes: number
  baseWage: number
  premiumPerHour: number
  dayKey: string
}

export function weekStartSundayKey(dateKey: string, tz: string): string {
  const d = dayjs.tz(`${dateKey}T12:00:00`, tz)
  return d.subtract(d.day(), 'day').format('YYYY-MM-DD')
}

export function parseSubsidyConfig(user: Record<string, unknown> | null | undefined): LaborSubsidyConfig | null {
  if (!user?.labor_subsidy_enabled) return null
  const wageCap = parseFloat(String(user.labor_subsidy_wage_cap ?? ''))
  const maxHours = parseFloat(String(user.labor_subsidy_max_hours_per_week ?? ''))
  if (!Number.isFinite(wageCap) || wageCap <= 0) return null
  if (!Number.isFinite(maxHours) || maxHours <= 0) return null
  return {
    enabled: true,
    partner: user.labor_subsidy_partner ? String(user.labor_subsidy_partner).trim() : null,
    wageCap,
    maxHoursPerWeek: maxHours,
    startDate: user.labor_subsidy_start_date ? String(user.labor_subsidy_start_date) : null,
    endDate: user.labor_subsidy_end_date ? String(user.labor_subsidy_end_date) : null,
  }
}

export function isSubsidyActiveOnDate(config: LaborSubsidyConfig, dateKey: string): boolean {
  if (config.startDate && dateKey < config.startDate) return false
  if (config.endDate && dateKey > config.endDate) return false
  return true
}

/** Flat + percentage premiums that apply to all clocked hours. */
export function premiumPerHourFromAssignments(
  baseWage: number,
  assignments: Array<{
    premium_rate?: unknown
    applies_to_all_hours?: boolean
    rate_type?: string | null
    is_active?: boolean
    approval_status?: string | null
  }>,
): number {
  let add = 0
  for (const row of assignments) {
    if (row.is_active === false) continue
    if (row.approval_status === 'pending' || row.approval_status === 'rejected') continue
    if (row.applies_to_all_hours === false) continue
    const rate = parseFloat(String(row.premium_rate ?? 0)) || 0
    const rateType = String(row.rate_type || 'fixed_amount')
    if (rateType === 'percentage') {
      add += baseWage * (rate / 100)
    } else {
      add += rate
    }
  }
  return add
}

export type EmployeeSubsidyBreakdown = {
  employeeId: string
  weeklySubsidizedHours: number
  weeklyCapHours: number
  todaySubsidyCredit: number
  todayWorkedHours: number
  capReached: boolean
}

export function datesForWeek(weekStartKey: string, tz: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    dayjs.tz(`${weekStartKey}T12:00:00`, tz).add(i, 'day').format('YYYY-MM-DD'))
}

export function weekKeysCoveringRange(startDateKey: string, endDateKey: string, tz: string): string[] {
  let cursor = weekStartSundayKey(startDateKey, tz)
  const endWeek = weekStartSundayKey(endDateKey, tz)
  const keys: string[] = []
  while (cursor <= endWeek) {
    keys.push(cursor)
    cursor = dayjs.tz(`${cursor}T12:00:00`, tz).add(7, 'day').format('YYYY-MM-DD')
  }
  return keys
}

export type TimesheetShiftRow = {
  employeeId: string
  shiftDate: string
  startTime: string
  endTime: string
  breakMinutes: number
  status: string
  baseWage: number
}

const NON_WORKED_SHIFT_STATUSES = new Set(['sick', 'no_show', 'cancelled'])

export function shiftPaidHours(shift: TimesheetShiftRow, tz: string): number {
  const status = String(shift.status || 'scheduled').toLowerCase()
  if (NON_WORKED_SHIFT_STATUSES.has(status)) return 0
  if (!shift.startTime || !shift.endTime || !shift.shiftDate) return 0

  const start = dayjs.tz(`${shift.shiftDate}T${shift.startTime}`, tz)
  let end = dayjs.tz(`${shift.shiftDate}T${shift.endTime}`, tz)
  if (!start.isValid() || !end.isValid()) return 0
  if (!end.isAfter(start)) end = end.add(1, 'day')

  const grossMin = end.diff(start, 'minute')
  const paidMin = Math.max(0, grossMin - (shift.breakMinutes || 0))
  return paidMin / 60
}

function distributeEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return []
  const totalCents = Math.round(total * 100)
  const base = Math.floor(totalCents / parts)
  const remainder = totalCents - base * parts
  return Array.from({ length: parts }, (_, i) => round2((base + (i < remainder ? 1 : 0)) / 100))
}

export type PeriodHoursLineRow = {
  employeeId: string
  periodStart: string
  periodEnd: string
  totalHours: number
}

/** @deprecated alias */
export type ApprovalLineRow = PeriodHoursLineRow

/**
 * Spread weekly hours → subsidized cap → subsidy dollars across Sun–Sat.
 * Skips employee-weeks that already have punch clocks or prior hour sources.
 */
export function applyPeriodHoursSpreadSubsidy(input: {
  lines: PeriodHoursLineRow[]
  subsidyByEmployee: Record<string, LaborSubsidyConfig>
  employeeWages: Record<string, number>
  punchWeekKeysByEmployee: Set<string>
  existingHoursByEmployeeWeek: Record<string, number>
  subsidyByDate: Record<string, number>
  tz: string
  outputStartKey: string
  outputEndKey: string
}): void {
  const {
    lines,
    subsidyByEmployee,
    employeeWages,
    punchWeekKeysByEmployee,
    existingHoursByEmployeeWeek,
    subsidyByDate,
    tz,
    outputStartKey,
    outputEndKey,
  } = input

  for (const line of lines) {
    if (!subsidyByEmployee[line.employeeId]) continue
    const weekStart = weekStartSundayKey(line.periodStart, tz)
    const weekKey = `${line.employeeId}|${weekStart}`
    if (punchWeekKeysByEmployee.has(weekKey)) continue
    if ((existingHoursByEmployeeWeek[weekKey] || 0) > 0) continue

    const config = subsidyByEmployee[line.employeeId]
    const baseWage = employeeWages[line.employeeId] ?? 0
    if (baseWage <= 0) continue

    const weekDays = datesForWeek(weekStart, tz)
    const actualWeekHours = Number(line.totalHours) || 0
    if (actualWeekHours <= 0) continue

    const subsidizedHours = Math.min(actualWeekHours, config.maxHoursPerWeek)
    const creditPerHour = Math.min(config.wageCap, baseWage)
    const weeklyCredit = round2(subsidizedHours * creditPerHour)
    const dailyCredits = distributeEvenly(weeklyCredit, 7)

    weekDays.forEach((dayKey, index) => {
      if (dayKey < outputStartKey || dayKey > outputEndKey) return
      if (!isSubsidyActiveOnDate(config, dayKey)) return
      subsidyByDate[dayKey] = round2((subsidyByDate[dayKey] || 0) + (dailyCredits[index] || 0))
    })

    existingHoursByEmployeeWeek[weekKey] = actualWeekHours
  }
}

/** @deprecated use applyPeriodHoursSpreadSubsidy */
export function applyApprovalLineSpreadSubsidy(input: {
  lines: ApprovalLineRow[]
  subsidyByEmployee: Record<string, LaborSubsidyConfig>
  employeeWages: Record<string, number>
  punchWeekKeysByEmployee: Set<string>
  shiftHoursByEmployeeWeek: Record<string, number>
  subsidyByDate: Record<string, number>
  tz: string
  outputStartKey: string
  outputEndKey: string
}): void {
  applyPeriodHoursSpreadSubsidy({
    ...input,
    existingHoursByEmployeeWeek: input.shiftHoursByEmployeeWeek,
  })
}

/**
 * Pre-punch fallback: weekly timesheet hours → subsidized cap → spread subsidy dollars
 * evenly across Sun–Sat. Skips employee-weeks that already have punch clocks.
 */
export function applyTimesheetSpreadSubsidy(input: {
  shifts: TimesheetShiftRow[]
  subsidyByEmployee: Record<string, LaborSubsidyConfig>
  employeeWages: Record<string, number>
  punchWeekKeysByEmployee: Set<string>
  subsidyByDate: Record<string, number>
  tz: string
  outputStartKey: string
  outputEndKey: string
}): void {
  const {
    shifts,
    subsidyByEmployee,
    employeeWages,
    punchWeekKeysByEmployee,
    subsidyByDate,
    tz,
    outputStartKey,
    outputEndKey,
  } = input

  const weekKeys = weekKeysCoveringRange(outputStartKey, outputEndKey, tz)
  const shiftsByEmployeeWeek: Record<string, TimesheetShiftRow[]> = {}

  for (const shift of shifts) {
    if (!subsidyByEmployee[shift.employeeId]) continue
    const weekStart = weekStartSundayKey(shift.shiftDate, tz)
    const key = `${shift.employeeId}|${weekStart}`
    if (!shiftsByEmployeeWeek[key]) shiftsByEmployeeWeek[key] = []
    shiftsByEmployeeWeek[key].push(shift)
  }

  for (const weekStart of weekKeys) {
    const weekDays = datesForWeek(weekStart, tz)

    for (const employeeId of Object.keys(subsidyByEmployee)) {
      const weekKey = `${employeeId}|${weekStart}`
      if (punchWeekKeysByEmployee.has(weekKey)) continue

      const config = subsidyByEmployee[employeeId]
      const baseWage = employeeWages[employeeId] ?? 0
      if (baseWage <= 0) continue

      let actualWeekHours = 0
      for (const shift of shiftsByEmployeeWeek[weekKey] || []) {
        if (!isSubsidyActiveOnDate(config, shift.shiftDate)) continue
        actualWeekHours += shiftPaidHours(shift, tz)
      }

      if (actualWeekHours <= 0) continue

      const subsidizedHours = Math.min(actualWeekHours, config.maxHoursPerWeek)
      const creditPerHour = Math.min(config.wageCap, baseWage)
      const weeklyCredit = round2(subsidizedHours * creditPerHour)
      const dailyCredits = distributeEvenly(weeklyCredit, 7)

      weekDays.forEach((dayKey, index) => {
        if (dayKey < outputStartKey || dayKey > outputEndKey) return
        subsidyByDate[dayKey] = round2((subsidyByDate[dayKey] || 0) + (dailyCredits[index] || 0))
      })
    }
  }
}

export function accumulateLaborAndSubsidyByDate(input: {
  clocks: ClockLaborRow[]
  subsidyByEmployee: Record<string, LaborSubsidyConfig>
  tz: string
}): { laborByDate: Record<string, number>; subsidyByDate: Record<string, number> } {
  const { clocks, subsidyByEmployee, tz } = input
  const sorted = [...clocks].sort((a, b) => a.clockInIso.localeCompare(b.clockInIso))
  const laborByDate: Record<string, number> = {}
  const subsidyByDate: Record<string, number> = {}
  const subsidizedMinutesUsed: Record<string, number> = {}

  for (const row of sorted) {
    const paidHours = row.paidMinutes / 60
    if (paidHours <= 0) continue

    const effectiveRate = row.baseWage + row.premiumPerHour
    const actualCost = paidHours * effectiveRate
    laborByDate[row.dayKey] = (laborByDate[row.dayKey] || 0) + actualCost

    const config = subsidyByEmployee[row.employeeId]
    if (!config || !isSubsidyActiveOnDate(config, row.dayKey)) continue

    const weekStart = weekStartSundayKey(row.dayKey, tz)
    const weekKey = `${row.employeeId}|${weekStart}`
    const capHours = config.maxHoursPerWeek
    const alreadyUsedMin = subsidizedMinutesUsed[weekKey] || 0
    const remainingMin = Math.max(0, capHours * 60 - alreadyUsedMin)
    const subsidizedMin = Math.min(row.paidMinutes, remainingMin)
    subsidizedMinutesUsed[weekKey] = alreadyUsedMin + subsidizedMin

    const subsidizedHours = subsidizedMin / 60
    const creditPerHour = Math.min(config.wageCap, row.baseWage)
    const credit = subsidizedHours * creditPerHour
    subsidyByDate[row.dayKey] = (subsidyByDate[row.dayKey] || 0) + credit
  }

  for (const key of Object.keys(laborByDate)) {
    laborByDate[key] = round2(laborByDate[key])
  }
  for (const key of Object.keys(subsidyByDate)) {
    subsidyByDate[key] = round2(subsidyByDate[key])
  }

  return { laborByDate, subsidyByDate }
}

export function computeLaborAndSubsidy(input: {
  clocks: ClockLaborRow[]
  subsidyByEmployee: Record<string, LaborSubsidyConfig>
  todayKey: string
}) {
  const { clocks, subsidyByEmployee, todayKey } = input

  const sorted = [...clocks].sort((a, b) => a.clockInIso.localeCompare(b.clockInIso))
  const subsidizedMinutesUsed: Record<string, number> = {}
  const todayPaidMinutes: Record<string, number> = {}
  const todaySubsidyCreditByEmployee: Record<string, number> = {}

  let laborDollars = 0
  let subsidyCreditToday = 0
  let laborDollarsToday = 0

  for (const row of sorted) {
    const paidHours = row.paidMinutes / 60
    if (paidHours <= 0) continue

    const effectiveRate = row.baseWage + row.premiumPerHour
    const actualCost = paidHours * effectiveRate
    laborDollars += actualCost
    if (row.dayKey === todayKey) {
      laborDollarsToday += actualCost
      todayPaidMinutes[row.employeeId] = (todayPaidMinutes[row.employeeId] || 0) + row.paidMinutes
    }

    const config = subsidyByEmployee[row.employeeId]
    if (!config || !isSubsidyActiveOnDate(config, row.dayKey)) continue

    const capHours = config.maxHoursPerWeek
    const alreadyUsedMin = subsidizedMinutesUsed[row.employeeId] || 0
    const remainingMin = Math.max(0, capHours * 60 - alreadyUsedMin)
    const subsidizedMin = Math.min(row.paidMinutes, remainingMin)
    subsidizedMinutesUsed[row.employeeId] = alreadyUsedMin + subsidizedMin

    const subsidizedHours = subsidizedMin / 60
    const creditPerHour = Math.min(config.wageCap, row.baseWage)
    const credit = subsidizedHours * creditPerHour

    if (row.dayKey === todayKey) {
      subsidyCreditToday += credit
      todaySubsidyCreditByEmployee[row.employeeId] =
        (todaySubsidyCreditByEmployee[row.employeeId] || 0) + credit
    }
  }

  const subsidyBreakdown: EmployeeSubsidyBreakdown[] = Object.keys(subsidyByEmployee).map((employeeId) => {
    const config = subsidyByEmployee[employeeId]
    const weeklySubsidizedHours = (subsidizedMinutesUsed[employeeId] || 0) / 60
    const todayWorkedHours = (todayPaidMinutes[employeeId] || 0) / 60
    const todaySubsidyCredit = todaySubsidyCreditByEmployee[employeeId] || 0
    return {
      employeeId,
      weeklySubsidizedHours: round2(weeklySubsidizedHours),
      weeklyCapHours: config.maxHoursPerWeek,
      todaySubsidyCredit: round2(todaySubsidyCredit),
      todayWorkedHours: round2(todayWorkedHours),
      capReached: weeklySubsidizedHours >= config.maxHoursPerWeek - 0.01,
    }
  })

  laborDollars = round2(laborDollars)
  laborDollarsToday = round2(laborDollarsToday)
  subsidyCreditToday = round2(subsidyCreditToday)
  const adjustedLaborDollars = round2(Math.max(0, laborDollarsToday - subsidyCreditToday))

  return {
    laborDollars,
    laborDollarsToday,
    subsidyCreditToday,
    adjustedLaborDollars,
    subsidyBreakdown,
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
