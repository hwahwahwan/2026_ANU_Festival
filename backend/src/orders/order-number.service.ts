import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

function getKstDateParts(now: Date): { isoDate: string; mmdd: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  return { isoDate: `${year}-${month}-${day}`, mmdd: `${month}${day}` };
}

@Injectable()
export class OrderNumberService {
  async issue(client: PoolClient, now: Date = new Date()): Promise<string> {
    const { isoDate, mmdd } = getKstDateParts(now);

    const result = await client.query<{ last_number: number }>(
      `INSERT INTO order_daily_counters (order_date, last_number)
       VALUES ($1::date, 1)
       ON CONFLICT (order_date)
       DO UPDATE SET last_number = order_daily_counters.last_number + 1
       RETURNING last_number`,
      [isoDate],
    );

    const sequence = result.rows[0].last_number;

    return `${mmdd}-${String(sequence).padStart(4, '0')}`;
  }
}
