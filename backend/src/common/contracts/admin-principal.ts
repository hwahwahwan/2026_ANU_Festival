export interface AdminJwtPayload {
  sub: string;
}

export interface AuthenticatedAdmin {
  adminId: string;
  expiresAt: number;
}
