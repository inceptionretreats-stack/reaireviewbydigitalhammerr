import Link from 'next/link';
import { Card, StatusBadge } from '@ai-review/ui';
import { MODE_EMPHASIS_NOTE, QR_UNAFFECTED_NOTE } from './copy';
import { TEXT_LINK } from './styles';

/**
 * The "Active mode" content of AI-01.
 *
 * A Server Component, and read-only on purpose: AI-02 owns creating, switching and archiving modes,
 * and duplicating the switch here would be a second path to the AI-02-01 invariant. So this states
 * which mode is in use and links to the screen that changes it.
 *
 * The empty case is not an error. `PUT /api/v1/ai/context` creates a Balanced mode the first time a
 * tenant saves their context, so a business with no mode simply has not saved yet, and saying that
 * is more useful than an empty dash.
 */

export interface ActiveModeCardProps {
  activeModeName: string | null;
  activeModeTerms: readonly string[];
  /**
   * Total modes, archived included, so the link can say whether there is anything to choose
   * between yet.
   */
  modeCount: number;
}

export function ActiveModeCard({
  activeModeName,
  activeModeTerms,
  modeCount,
}: ActiveModeCardProps) {
  return (
    <Card
      title="Review mode in use"
      titleAs="h2"
      description="The mode decides which of your topics a new draft leans on."
    >
      <div className="flex flex-col gap-3">
        {activeModeName === null ? (
          <p className="text-sm text-ink">
            No mode is in use yet. A mode called <strong>Balanced</strong> is set up for you the
            first time you save this page, and it deliberately adds no extra emphasis.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink">{activeModeName}</span>
              <StatusBadge status="ACTIVE" label="In use" />
            </div>
            <p className="text-sm text-ink-muted">
              {activeModeTerms.length === 0
                ? 'No extra terms — it leans on your business context as it is.'
                : `Extra emphasis on: ${activeModeTerms.join(', ')}.`}
            </p>
          </div>
        )}

        <p className="text-sm text-ink-muted">{MODE_EMPHASIS_NOTE}</p>

        {/* AI-02-03, said on this screen too: switching is the action an owner hesitates over. */}
        <p className="text-sm text-ink-muted">{QR_UNAFFECTED_NOTE}</p>

        <p className="text-sm">
          <Link href="/app/review-modes" className={TEXT_LINK}>
            {modeCount > 1 ? 'Switch or manage review modes' : 'Create another review mode'}
          </Link>
        </p>
      </div>
    </Card>
  );
}
