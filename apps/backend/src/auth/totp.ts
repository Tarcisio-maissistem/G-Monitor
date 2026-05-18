import { authenticator } from 'otplib';

// TOTP RFC 6238 com janela de 1 (±30s) para tolerar dessincronia leve.
authenticator.options = { window: 1, step: 30 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(label: string, secret: string, issuer = 'G-Monitor'): string {
  return authenticator.keyuri(label, issuer, secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  return authenticator.verify({ token: code, secret });
}
