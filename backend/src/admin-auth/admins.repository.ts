import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AdminRecord {
  id: string;
  username: string;
  passwordHash: string;
}

interface AdminRow {
  id: string;
  username: string;
  password_hash: string;
}

@Injectable()
export class AdminsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByUsername(username: string): Promise<AdminRecord | null> {
    const result = await this.database.query<AdminRow>(
      'SELECT id, username, password_hash FROM admins WHERE username = $1',
      [username],
    );

    return this.toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<AdminRecord | null> {
    const result = await this.database.query<AdminRow>(
      'SELECT id, username, password_hash FROM admins WHERE id = $1',
      [id],
    );

    return this.toRecord(result.rows[0]);
  }

  private toRecord(row: AdminRow | undefined): AdminRecord | null {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
    };
  }
}
