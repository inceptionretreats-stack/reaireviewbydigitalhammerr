import { permanentRedirect } from 'next/navigation';

export default function FreePlanDetailsPage(): never {
  permanentRedirect('/legal/pricing');
}
