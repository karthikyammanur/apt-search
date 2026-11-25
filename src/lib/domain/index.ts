// Cost model, hard filters, scoring, feedback and explanations. Pure functions, no I/O.

export * from "./types";
export * from "./cost";
export * from "./filters";
export * from "./score";
export * from "./feedback";
export * from "./explain";
export { analyzeLease, type LeaseAnalysis } from "./lease";
export { stayPeriod, acceptableLeaseMonths, DAYS_PER_MONTH, type Stay } from "./stay";
export * from "./fails";
export * from "./draft";
export { fmtCents, fmtDate, fmtDay, fmtDayRange, fmtDollars, fmtWeight, tidyText } from "./format";
