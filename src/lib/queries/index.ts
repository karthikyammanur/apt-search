// Typed reads and small writes shared by the chat (step 6) and the screens (step 7), so neither
// writes SQL. Every function takes an optional { db, now } last; the app uses the shared database.
// Numbers here come from the enrichment and facts tables, which only domain code and providers fill.

export { getBoard, type Board, type BoardFilter, type BoardItem, type BucketCounts, type UserStatus } from "./board";
export {
  compareListings,
  getListing,
  type CompareRow,
  type CompareValue,
  type Comparison,
  type FactEntry,
  type ListingDetail,
  type NearbyStopDetail,
  type Poi,
  type TrustCheck,
} from "./listing";
export {
  getLeads,
  getSourceRuns,
  updateRoommateLeadStatus,
  type Channel,
  type GroupCapture,
  type LeadStatus,
  type RoommateLead,
  type SourceRuns,
  type SourceStatus,
  type WriteResult,
} from "./leads";
export { getSettings, recheckAllListings, updateSettings, type AppSettings, type WeightRow } from "./settings";
export { recordFact, setUserStatus, type AnalysisSnapshot, type RecordFactResult } from "./writes";
export {
  getChatMessages,
  getFeedbackEvents,
  saveChatMessage,
  saveFeedbackEvent,
  undoLastFeedbackEvent,
  type ChatRole,
  type FeedbackEvent,
  type StoredChatMessage,
} from "./chat";
export type { FactRow, QueryOptions } from "./shared";
export { getMapPoints, type MapPoints } from "./map";
