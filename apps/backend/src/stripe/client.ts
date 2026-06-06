import Stripe from 'stripe';
import { config } from '../config.js';

// Cliente Stripe lazy: so instancia se chave configurada.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY nao configurada');
    _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  }
  return _stripe;
}
