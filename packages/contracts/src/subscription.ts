import { z } from 'zod';

/**
 * SUB-01 request shapes (E10-02, AC-016).
 *
 * The verify body is exactly what Razorpay's Checkout.js hands the success handler, under the
 * names it uses — `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` — so the
 * browser forwards the object untouched and nothing is renamed on the way to the signature
 * check. The ids are bounded and shaped: a signature check is cheap, but a body that is not
 * even an id should not reach it.
 */

const razorpayId = (prefix: string) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`), `Not a Razorpay ${prefix} id.`);

export const checkoutVerifyRequest = z.object({
  razorpay_order_id: razorpayId('order'),
  razorpay_payment_id: razorpayId('pay'),
  razorpay_signature: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, 'Not a payment signature.'),
});

export type CheckoutVerifyRequest = z.infer<typeof checkoutVerifyRequest>;
