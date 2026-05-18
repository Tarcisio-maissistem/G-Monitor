import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { config } from '../config.js';
import { getStripe } from './client.js';
import { logger } from '../logger.js';

const checkoutSchema = z.object({ plan: z.enum(['starter', 'business']) });

const PRICE_MAP = {
  starter: (): string | undefined => config.STRIPE_PRICE_STARTER,
  business: (): string | undefined => config.STRIPE_PRICE_BUSINESS,
};

export async function stripeRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/stripe/checkout',
    { preHandler: [requireAuth, requireCapability('billing.manage')] },
    async (req) => {
      const body = checkoutSchema.parse(req.body);
      const price = PRICE_MAP[body.plan]();
      if (!price) throw Errors.validation('Plano nao configurado');

      const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
      if (!tenant) throw Errors.notFound();

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        customer: tenant.stripeCustomerId ?? undefined,
        client_reference_id: tenant.id,
        success_url: `${config.CORS_ORIGIN}/billing?ok=1`,
        cancel_url: `${config.CORS_ORIGIN}/billing?cancel=1`,
        metadata: { tenantId: tenant.id, plan: body.plan },
      });

      return { url: session.url };
    },
  );

  app.post(
    '/api/stripe/portal',
    { preHandler: [requireAuth, requireCapability('billing.manage')] },
    async (req) => {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
      if (!tenant?.stripeCustomerId) throw Errors.validation('Sem assinatura Stripe');
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeCustomerId,
        return_url: `${config.CORS_ORIGIN}/billing`,
      });
      return { url: session.url };
    },
  );

  // Webhook precisa do body RAW. Registro com content-type parser custom em index.ts.
  app.post('/api/stripe/webhook', async (req, reply) => {
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') throw Errors.unauthorized();
    if (!config.STRIPE_WEBHOOK_SECRET) throw Errors.validation('Webhook secret nao configurado');

    const stripe = getStripe();
    const raw = (req as unknown as { rawBody: Buffer }).rawBody;

    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn({ err }, 'stripe webhook invalid signature');
      reply.status(400).send({ error: 'invalid signature' });
      return;
    }

    logger.info({ type: event.type }, 'stripe webhook');

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as import('stripe').Stripe.Checkout.Session;
        const tenantId = session.client_reference_id;
        const customerId = typeof session.customer === 'string' ? session.customer : null;
        if (tenantId && customerId) {
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { stripeCustomerId: customerId },
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as import('stripe').Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : '';
        const tenant = await prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } });
        if (!tenant) break;

        const status = mapStripeStatus(sub.status);
        await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: status } });

        await prisma.subscription.upsert({
          where: { stripeSubscriptionId: sub.id },
          create: {
            tenantId: tenant.id,
            stripeSubscriptionId: sub.id,
            status: sub.status,
            plan: 'starter',
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
          update: {
            status: sub.status,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        });
        break;
      }
    }

    reply.send({ received: true });
  });
}

function mapStripeStatus(s: string): 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' {
  switch (s) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return 'suspended';
  }
}
