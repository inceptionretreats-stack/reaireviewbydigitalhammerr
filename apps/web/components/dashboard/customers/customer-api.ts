import { isCustomerStatus, type OwnerSettableStatus } from '@/lib/crm/customers/customer-status';
import type { CustomerDto, CustomerListPage } from '@/lib/crm/customers/repository';
import type { SubmitFailure } from '@/components/shared/forms/use-form-submit';

/**
 * The browser half of the `/api/v1/customers` contract.
 *
 * `components/shared/forms/use-form-submit.ts` is not reused for the calls themselves: it only issues POSTs,
 * and this screen also has to PATCH, DELETE and GET. Its `SubmitFailure` type *is* imported rather
 * than redeclared, so the one error envelope in `23_API_Error_Codes.md` still has one shape in the
 * browser.
 *
 * Every response is parsed defensively rather than cast. A dashboard behind a proxy or a captive
 * portal can be handed an HTML error page with a 200 on it, and a cast turns that into `undefined`
 * scattered through a table instead of one honest failure message.
 *
 * Only DTO *types* are imported from the endpoint's `repository.ts`. `import type` is erased under
 * `verbatimModuleSyntax`, so no drizzle or `pg` code reaches the browser bundle.
 */

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: SubmitFailure };

/** The body both writes take. Empty optional fields are omitted; the server reads that as "clear". */
export interface CustomerInput {
  name: string;
  mobile: string;
  email?: string;
  visit_date?: string;
  note?: string;
  /** PATCH only, and only ever a value the owner is allowed to set (see `customer-status.ts`). */
  status?: OwnerSettableStatus;
}

export interface ListParams {
  q: string;
  page: number;
  signal?: AbortSignal;
}

/** Marks a response that was superseded by a newer request, so the caller can ignore it silently. */
export const ABORTED_CODE = 'ABORTED';

export async function getCustomerPage(params: ListParams): Promise<ApiResult<CustomerListPage>> {
  const search = new URLSearchParams({ q: params.q, page: String(params.page) });

  return request(`/api/v1/customers?${search.toString()}`, boxed(readListPage), {
    method: 'GET',
    signal: params.signal,
  });
}

export async function postCustomer(input: CustomerInput): Promise<ApiResult<CustomerDto>> {
  return request('/api/v1/customers', boxed(readCustomerEnvelope), jsonBody('POST', input));
}

export async function patchCustomer(
  id: string,
  input: CustomerInput,
): Promise<ApiResult<CustomerDto>> {
  return request(
    `/api/v1/customers/${encodeURIComponent(id)}`,
    boxed(readCustomerEnvelope),
    jsonBody('PATCH', input),
  );
}

/** Soft delete (AC-040). 204 with no body, so there is nothing to read back. */
export async function deleteCustomer(id: string): Promise<ApiResult<null>> {
  return request(`/api/v1/customers/${encodeURIComponent(id)}`, () => ({ value: null }), {
    method: 'DELETE',
  });
}

/**
 * A reader answers "is this the body I expected, and what is in it?".
 *
 * It returns a box rather than the value itself so that `null` can be a legitimate result — which it
 * is for DELETE — without being indistinguishable from "this body made no sense".
 */
type Reader<T> = (payload: unknown) => { value: T } | null;

function boxed<T>(read: (payload: unknown) => T | null): Reader<T> {
  return (payload) => {
    const value = read(payload);
    return value === null ? null : { value };
  };
}

function jsonBody(method: 'POST' | 'PATCH', input: CustomerInput): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  };
}

/** One fetch, one envelope, one place that decides what a failed call says to the owner. */
async function request<T>(url: string, read: Reader<T>, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) return { ok: false, failure: readFailure(payload) };

    const box = read(payload);
    // A body that does not have the expected shape is a failure, not an empty result. That
    // distinction is what stops a garbled response looking like "you have no customers".
    if (!box) return { ok: false, failure: UNEXPECTED };

    return { ok: true, value: box.value };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, failure: ABORTED };
    }
    return { ok: false, failure: OFFLINE };
  }
}

const ABORTED: SubmitFailure = { code: ABORTED_CODE, message: '', fields: [] };

const OFFLINE: SubmitFailure = {
  code: 'NETWORK',
  message: 'Could not reach the server. Check your connection and try again.',
  fields: [],
};

const UNEXPECTED: SubmitFailure = {
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong. Please try again.',
  fields: [],
};

/** The error envelope from `23_API_Error_Codes.md`. The API's `message` is always safe to show. */
function readFailure(payload: unknown): SubmitFailure {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return UNEXPECTED;

  const error = (payload as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return UNEXPECTED;

  const record = error as Record<string, unknown>;
  const details = record.details as { fields?: unknown } | undefined;

  return {
    code: typeof record.code === 'string' ? record.code : UNEXPECTED.code,
    message: typeof record.message === 'string' ? record.message : UNEXPECTED.message,
    fields: Array.isArray(details?.fields)
      ? details.fields.filter((field): field is string => typeof field === 'string')
      : [],
  };
}

function readCustomerEnvelope(payload: unknown): CustomerDto | null {
  if (typeof payload !== 'object' || payload === null || !('customer' in payload)) return null;
  return readCustomer((payload as { customer: unknown }).customer);
}

function readListPage(payload: unknown): CustomerListPage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.customers)) return null;

  const parsed: CustomerDto[] = [];
  for (const entry of record.customers) {
    const customer = readCustomer(entry);
    // One unreadable row means the shape is not what this build expects. Showing the rest would
    // quietly drop a contact that exists.
    if (!customer) return null;
    parsed.push(customer);
  }

  return {
    customers: parsed,
    page: readNumber(record.page, 1),
    per_page: readNumber(record.per_page, parsed.length),
    total: readNumber(record.total, parsed.length),
    total_pages: readNumber(record.total_pages, 1),
    q: typeof record.q === 'string' ? record.q : '',
  };
}

function readCustomer(value: unknown): CustomerDto | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string') return null;
  if (typeof record.name !== 'string') return null;
  if (typeof record.mobile !== 'string') return null;
  if (typeof record.created_at !== 'string') return null;
  if (typeof record.updated_at !== 'string') return null;
  if (!isCustomerStatus(record.status)) return null;

  return {
    id: record.id,
    name: record.name,
    mobile: record.mobile,
    email: readText(record.email),
    visit_date: readText(record.visit_date),
    note: readText(record.note),
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
