// All SQL in one place, as prepared statements.
import type { CustomerRecord } from '../core/customers-csv.ts';
import type { Category } from '../core/nps.ts';
import type { DB } from './db.ts';

export type ResponseKind = 'live' | 'test' | 'demo';
export type EventType = 'view' | 'score_selected' | 'step2_done' | 'submitted';
export type FollowupStatus = 'none' | 'todo' | 'called' | 'resolved' | 'unreachable';

export interface CustomerMatch {
  id: number;
  name: string | null;
  company: string | null;
  sales_rep: string | null;
  value_tier: string | null;
}

export interface NewResponse {
  mobile: string;
  customer_id: number | null;
  score: number;
  category: Category;
  drivers: string;
  comment: string | null;
  contact_ok: 0 | 1;
  src: string;
  rep: string | null;
  duration_ms: number | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
  followup_status: FollowupStatus;
  theme_tags: string;
  kind: ResponseKind;
}

/** Response joined with its customer — the row shape used by exports (and later the dashboard). */
export interface ResponseRow {
  id: number;
  mobile: string;
  customer_id: number | null;
  score: number;
  category: Category;
  drivers: string;
  comment: string | null;
  contact_ok: number;
  src: string;
  rep: string | null;
  duration_ms: number | null;
  created_at: string;
  followup_status: FollowupStatus;
  followup_note: string | null;
  followup_by: string | null;
  followup_at: string | null;
  theme_tags: string;
  featured: number;
  kind: ResponseKind;
  name: string | null;
  company: string | null;
  city: string | null;
  province: string | null;
  customer_type: string | null;
  value_tier: string | null;
  sales_rep: string | null;
}

export interface Stats {
  live: number;
  demo: number;
  test: number;
  matched: number;
  todo: number;
  customers: number;
  demo_customers: number;
  duplicates: number;
}

export interface CustomerRow extends CustomerRecord {
  id: number;
  imported_at: string;
  is_demo: number;
}

const RESPONSE_COLUMNS = `
  r.id, r.mobile, r.customer_id, r.score, r.category, r.drivers, r.comment, r.contact_ok, r.src, r.rep,
  r.duration_ms, r.created_at, r.followup_status, r.followup_note, r.followup_by, r.followup_at,
  r.theme_tags, r.featured, r.kind,
  c.name, c.company, c.city, c.province, c.customer_type, c.value_tier, c.sales_rep`;

export function createRepo(db: DB) {
  const s = {
    customerByMobile: db.prepare<[string], CustomerMatch>(
      'SELECT id, name, company, sales_rep, value_tier FROM customers WHERE mobile = ?',
    ),
    liveResponseExists: db.prepare<[string], { x: number }>(
      "SELECT 1 AS x FROM responses WHERE mobile = ? AND kind = 'live'",
    ),
    insertResponse: db.prepare<NewResponse>(`
      INSERT INTO responses (mobile, customer_id, score, category, drivers, comment, contact_ok, src, rep,
        duration_ms, ip_hash, user_agent, created_at, followup_status, theme_tags, kind)
      VALUES (@mobile, @customer_id, @score, @category, @drivers, @comment, @contact_ok, @src, @rep,
        @duration_ms, @ip_hash, @user_agent, @created_at, @followup_status, @theme_tags, @kind)`),
    insertDuplicate: db.prepare<[string, number, string]>(
      'INSERT INTO duplicate_attempts (mobile, score, created_at) VALUES (?, ?, ?)',
    ),
    insertEvent: db.prepare<[string, EventType, string, string]>(
      'INSERT OR IGNORE INTO events (session_id, type, src, created_at) VALUES (?, ?, ?, ?)',
    ),
    commentsForRetag: db.prepare<[], { id: number; comment: string | null; theme_tags: string }>(
      'SELECT id, comment, theme_tags FROM responses',
    ),
    setThemeTags: db.prepare<[string, number]>('UPDATE responses SET theme_tags = ? WHERE id = ?'),
    rematch: db.prepare(`
      UPDATE responses SET customer_id = (SELECT c.id FROM customers c WHERE c.mobile = responses.mobile)
      WHERE customer_id IS NOT (SELECT c.id FROM customers c WHERE c.mobile = responses.mobile)`),
    matchedCount: db.prepare<[], { matched: number; unmatched: number }>(`
      SELECT COALESCE(SUM(customer_id IS NOT NULL), 0) AS matched, COALESCE(SUM(customer_id IS NULL), 0) AS unmatched
      FROM responses WHERE kind <> 'test'`),
    customerMobiles: db.prepare<[], { mobile: string }>('SELECT mobile FROM customers'),
    upsertCustomer: db.prepare<CustomerRecord & { imported_at: string }>(`
      INSERT INTO customers (mobile, name, company, city, province, customer_type, value_tier, sales_rep,
        first_purchase_date, imported_at, is_demo)
      VALUES (@mobile, @name, @company, @city, @province, @customer_type, @value_tier, @sales_rep,
        @first_purchase_date, @imported_at, 0)
      ON CONFLICT(mobile) DO UPDATE SET
        name = COALESCE(excluded.name, customers.name),
        company = COALESCE(excluded.company, customers.company),
        city = COALESCE(excluded.city, customers.city),
        province = COALESCE(excluded.province, customers.province),
        customer_type = COALESCE(excluded.customer_type, customers.customer_type),
        value_tier = COALESCE(excluded.value_tier, customers.value_tier),
        sales_rep = COALESCE(excluded.sales_rep, customers.sales_rep),
        first_purchase_date = COALESCE(excluded.first_purchase_date, customers.first_purchase_date),
        imported_at = excluded.imported_at,
        is_demo = 0`),
    distinctReps: db.prepare<[], { rep: string }>(`
      SELECT DISTINCT sales_rep AS rep FROM customers WHERE sales_rep IS NOT NULL AND sales_rep <> '' ORDER BY rep`),
    stats: db.prepare<[], Stats>(`
      SELECT
        (SELECT COUNT(*) FROM responses WHERE kind = 'live') AS live,
        (SELECT COUNT(*) FROM responses WHERE kind = 'demo') AS demo,
        (SELECT COUNT(*) FROM responses WHERE kind = 'test') AS test,
        (SELECT COUNT(*) FROM responses WHERE kind <> 'test' AND customer_id IS NOT NULL) AS matched,
        (SELECT COUNT(*) FROM responses WHERE kind <> 'test' AND category = 'detractor' AND followup_status = 'todo') AS todo,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM customers WHERE is_demo = 1) AS demo_customers,
        (SELECT COUNT(*) FROM duplicate_attempts) AS duplicates`),
    scores: db.prepare<[], { score: number }>("SELECT score FROM responses WHERE kind <> 'test'"),
    responsesForExport: db.prepare<[], ResponseRow>(`
      SELECT ${RESPONSE_COLUMNS} FROM responses r LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.kind <> 'test' ORDER BY r.created_at`),
    followups: db.prepare<[], ResponseRow>(`
      SELECT ${RESPONSE_COLUMNS} FROM responses r LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.kind <> 'test' AND r.category = 'detractor'
      ORDER BY CASE c.value_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, r.created_at`),
    nonRespondents: db.prepare<[], CustomerRow>(`
      SELECT * FROM customers c
      WHERE NOT EXISTS (SELECT 1 FROM responses r WHERE r.mobile = c.mobile AND r.kind <> 'test')
      ORDER BY CASE c.value_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, c.sales_rep, c.name`),
    deleteByMobile: db.prepare<[string]>('DELETE FROM responses WHERE mobile = ?'),
    deleteTest: db.prepare("DELETE FROM responses WHERE kind = 'test'"),
  };

  return {
    findCustomerByMobile: (mobile: string) => s.customerByMobile.get(mobile),
    hasLiveResponse: (mobile: string) => s.liveResponseExists.get(mobile) !== undefined,
    insertResponse: (row: NewResponse) => Number(s.insertResponse.run(row).lastInsertRowid),
    insertDuplicate: (mobile: string, score: number, createdAt: string) => {
      s.insertDuplicate.run(mobile, score, createdAt);
    },
    /** Each (session, step) is stored once; returns false when it was already there. */
    insertEvent: (sessionId: string, type: EventType, src: string, createdAt: string) =>
      s.insertEvent.run(sessionId, type, src, createdAt).changes > 0,
    commentsForRetag: () => s.commentsForRetag.all(),
    setThemeTags: (id: number, tagsJson: string) => {
      s.setThemeTags.run(tagsJson, id);
    },
    /** Links every response to the customer with the same mobile (or unlinks it if the customer is gone). */
    rematchAll: () => {
      const changed = s.rematch.run().changes;
      return { changed, ...s.matchedCount.get()! };
    },
    customerMobiles: () => new Set(s.customerMobiles.all().map((r) => r.mobile)),
    upsertCustomer: (record: CustomerRecord, importedAt: string) => {
      s.upsertCustomer.run({ ...record, imported_at: importedAt });
    },
    distinctReps: () => s.distinctReps.all().map((r) => r.rep),
    stats: () => s.stats.get()!,
    scores: () => s.scores.all().map((r) => r.score),
    responsesForExport: () => s.responsesForExport.all(),
    followups: () => s.followups.all(),
    nonRespondents: () => s.nonRespondents.all(),
    deleteResponsesByMobile: (mobile: string) => s.deleteByMobile.run(mobile).changes,
    deleteTestResponses: () => s.deleteTest.run().changes,
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

export type Repo = ReturnType<typeof createRepo>;
