import { NextResponse } from 'next/server';
import { StoreError } from './store';
import { TailoringError } from '../tailoring/provider';

/** Converts thrown errors into a JSON response with a safe, actionable message. */
export function errorResponse(error: unknown, fallback = 'Something went wrong. Please try again.') {
  console.error('[api]', error);
  if (error instanceof StoreError) return NextResponse.json({ error: error.userMessage }, { status: error.status >= 400 && error.status < 600 ? error.status : 500 });
  if (error instanceof TailoringError) return NextResponse.json({ error: error.userMessage }, { status: 502 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
