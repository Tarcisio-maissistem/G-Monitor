import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const accessSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(config.JWT_REFRESH_SECRET);

export interface AccessPayload {
  sub: string;       // userId
  tid: string;       // tenantId
  rol: string;       // role
  sto?: string;      // storeId quando aplicavel
}

export async function signAccess(payload: AccessPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .setIssuer('gmonitor')
    .sign(accessSecret);
}

export async function verifyAccess(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, accessSecret, { issuer: 'gmonitor' });
  return payload as unknown as AccessPayload;
}

export async function signRefresh(userId: string, jti: string): Promise<string> {
  return new SignJWT({ sub: userId, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.REFRESH_TOKEN_TTL)
    .setIssuer('gmonitor')
    .sign(refreshSecret);
}

export async function verifyRefresh(token: string): Promise<{ sub: string; jti: string }> {
  const { payload } = await jwtVerify(token, refreshSecret, { issuer: 'gmonitor' });
  return { sub: payload.sub as string, jti: payload.jti as string };
}
