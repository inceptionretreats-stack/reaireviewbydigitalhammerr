import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewFlowProps } from '@/components/ReviewFlow';

const mocks = {
  db: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  headers: vi.fn(),
  resolveBySlug: vi.fn(),
  resolveAnonymousSession: vi.fn(),
  loadPublicServices: vi.fn(),
  loadLatestDraft: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
};

type PageResult = { props: { children: { props: ReviewFlowProps } } };
type Page = (input: { params: Promise<{ slug: string }> }) => Promise<PageResult>;

// The web tsconfig preserves JSX for Next, which Vitest cannot import directly. Compile only
// this page with the installed TypeScript compiler and run its real logic with in-memory doubles.
function loadPage(): Page {
  const source = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      jsx: JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as { default?: Page } };
  const dependencies: Record<string, unknown> = {
    'next/navigation': { notFound: mocks.notFound, redirect: mocks.redirect },
    'next/headers': { headers: mocks.headers },
    '@ai-review/db': { analyticsEvents: 'analytics_events' },
    '@/lib/db': { db: mocks.db },
    '@/lib/public-business': {
      resolveBySlug: mocks.resolveBySlug,
      loadPublicServices: mocks.loadPublicServices,
    },
    '@/lib/anonymous-session': { resolveAnonymousSession: mocks.resolveAnonymousSession },
    '@/lib/generation-service': { loadLatestDraft: mocks.loadLatestDraft },
    '@/components/ReviewFlow': { ReviewFlow: () => null },
    '@/components/CustomerReview.module.css': { page: 'page' },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
  };
  runInNewContext(outputText, {
    exports: module.exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    Request,
  });
  if (!module.exports.default) throw new Error('Missing page export');
  return module.exports.default;
}

const config = {
  businessId: 'business-1',
  slug: 'shop',
  name: 'Shop',
  logoUrl: null,
  reviewUrl: 'https://example.com/review',
  reviewPlatformLabel: 'Google',
  qrCodeId: null,
  qrSourceLabel: null,
};

describe('/[slug]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.mockReturnValue({ insert: mocks.insert });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockResolvedValue(undefined);
    mocks.headers.mockResolvedValue(new Headers());
    mocks.resolveBySlug.mockResolvedValue({ ok: true, config });
    mocks.loadPublicServices.mockResolvedValue(['Haircut', 'Colour']);
    mocks.loadLatestDraft.mockResolvedValue({ text: 'Saved draft', generationId: 'draft-1' });
  });

  it('restores the session draft and records a page view for the resolved business', async () => {
    mocks.resolveAnonymousSession.mockResolvedValue({
      sessionId: 'session-1',
      businessId: config.businessId,
    });

    const page = await loadPage()({ params: Promise.resolve({ slug: 'shop' }) });
    const flow = page.props.children;

    expect(mocks.resolveAnonymousSession).toHaveBeenCalledWith(expect.any(Request), 'business-1');
    expect(mocks.loadLatestDraft).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(flow.props.initialDraft).toEqual({ text: 'Saved draft', generationId: 'draft-1' });
    expect(flow.props.business.services).toEqual(['Haircut', 'Colour']);
    expect(mocks.insert).toHaveBeenCalledWith('analytics_events');
    expect(mocks.values).toHaveBeenCalledWith({
      businessId: 'business-1',
      anonymousSessionId: 'session-1',
      eventName: 'review_page_view',
      properties: { business_id: 'business-1', anonymous_session_id: 'session-1' },
    });
  });

  it('renders without a draft or analytics event when the visitor has no session', async () => {
    mocks.resolveAnonymousSession.mockResolvedValue(null);

    const page = await loadPage()({ params: Promise.resolve({ slug: 'shop' }) });

    expect(page.props.children.props.initialDraft).toBeNull();
    expect(mocks.loadLatestDraft).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('keeps the review page available when analytics storage fails', async () => {
    mocks.resolveAnonymousSession.mockResolvedValue({
      sessionId: 'session-1',
      businessId: config.businessId,
    });
    mocks.values.mockRejectedValue(new Error('analytics unavailable'));

    const page = await loadPage()({ params: Promise.resolve({ slug: 'shop' }) });

    expect(page.props.children.props.initialDraft).toEqual({
      text: 'Saved draft',
      generationId: 'draft-1',
    });
  });

  it('does not record a page view for a retired slug before its redirect', async () => {
    mocks.resolveBySlug.mockResolvedValue({ ok: true, redirectTo: '/shop' });

    await expect(loadPage()({ params: Promise.resolve({ slug: 'old-shop' }) })).rejects.toThrow(
      'REDIRECT',
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/shop/review');
    expect(mocks.resolveAnonymousSession).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
