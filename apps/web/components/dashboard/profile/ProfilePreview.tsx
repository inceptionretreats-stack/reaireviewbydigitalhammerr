import { Card } from '@ai-review/ui';
import { PRIMARY_LINK, SECONDARY_LINK } from '../link-styles';
import type { SectionType } from './sections';

/**
 * PROFILE-01's `preview` state: what a visitor gets, rendered from what is stored.
 *
 * Deliberately shows the *saved* page rather than the unsaved form. The public page renders from the
 * database, so previewing the boxes on screen would show the owner a page that does not exist yet —
 * and the one thing a preview must never do is disagree with the thing it is previewing. When there
 * are unsaved edits the panel says so instead of quietly including them.
 *
 * Which sections appear is decided by `rendersPublicly` (see `sections.ts`), the editor's mirror of
 * AC-020: a hidden section, or one with nothing to point at, is *absent* here exactly as it is absent
 * from the public HTML — not greyed out, not struck through.
 *
 * Nothing here is interactive. The buttons are `<div>`s, not links: this is a picture of a page, and
 * a real anchor would invite the owner to click through and would make the preview part of their own
 * public analytics. The private-feedback row is shown as permanent because it is — D-010 and AC-024
 * offer it to every visitor unconditionally, and no setting on this screen can remove it.
 */

export interface PreviewSection {
  id: string;
  type: SectionType;
  label: string;
}

export interface ProfilePreviewProps {
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  /** Already filtered and ordered by the editor, so this component makes no decisions. */
  sections: readonly PreviewSection[];
  /** How many stored sections a visitor does not see, so their absence reads as a choice. */
  hiddenCount: number;
  hasUnsavedChanges: boolean;
  publicUrl: string | null;
  isLive: boolean;
}

export function ProfilePreview({
  name,
  description,
  logoUrl,
  coverUrl,
  sections,
  hiddenCount,
  hasUnsavedChanges,
  publicUrl,
  isLive,
}: ProfilePreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      {hasUnsavedChanges && (
        <p role="status" className="text-sm font-medium text-ink">
          This is your saved page. Save your changes to see them here.
        </p>
      )}

      <Card
        title="Preview"
        titleAs="h2"
        description={
          isLive
            ? 'This is what a visitor sees on your public page.'
            : 'This is what a visitor will see once you publish your page.'
        }
        footer={
          <>
            {publicUrl !== null && <span className="break-all">{publicUrl}</span>}
            {hiddenCount > 0 && (
              <p className="mt-1">
                {hiddenCount === 1
                  ? '1 section is hidden or has no link, so it is not on your page at all.'
                  : `${hiddenCount} sections are hidden or have no link, so they are not on your page at all.`}
              </p>
            )}
          </>
        }
      >
        {/* A phone-width column, because that is how nearly every visitor arrives. */}
        <div className="mx-auto flex max-w-sm flex-col gap-4 rounded-card bg-surface p-4">
          {coverUrl !== null && (
            <img
              src={coverUrl}
              alt=""
              width={1200}
              height={400}
              className="block h-auto w-full rounded-control object-cover"
              style={{ aspectRatio: '3 / 1' }}
            />
          )}

          <div className="flex flex-col items-center gap-2 text-center">
            {/*
              Decorative in the same way as on the public page: the business name follows immediately
              as text, so alt text here would have a screen reader announce it twice.
            */}
            {logoUrl !== null && (
              <img
                src={logoUrl}
                alt=""
                width={72}
                height={72}
                className="size-18 rounded-pill object-cover"
              />
            )}
            <p className="text-lg font-bold text-ink">{name}</p>
            {description !== null && description !== '' && (
              <p className="text-sm text-ink-muted">{description}</p>
            )}
          </div>

          {sections.length > 0 ? (
            <ul role="list" className="m-0 flex list-none flex-col gap-2 p-0">
              {sections.map((section) => (
                <li key={section.id}>
                  {/*
                    Review Us is emphasised wherever the owner placed it, matching the public page:
                    emphasis follows the section type, not its position (D-015).
                  */}
                  <div
                    className={`${
                      section.type === 'GOOGLE_REVIEW' ? PRIMARY_LINK : SECONDARY_LINK
                    } w-full cursor-default`}
                  >
                    {section.label}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-ink-muted">
              No buttons yet. Add a link to a section and switch it on, and it appears here.
            </p>
          )}

          <p className="text-center text-sm text-accent">Send private feedback</p>
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        Every visitor is also offered private feedback, which is always available and is not
        something this screen can switch off (D-010).
      </p>
    </div>
  );
}
