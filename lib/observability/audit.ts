/**
 * Audit helpers for structured logging.
 *
 * Audit events are regular logs with consistent 'audit.*' attributes,
 * enabling queries like: audit.event_type="tool.denied"
 *
 * @example
 * import { auditToolApproved, auditToolDenied } from '../lib/observability/audit.js'
 *
 * auditToolApproved(logger, 'bash')
 * // {"audit.event_type":"tool.approved","audit.tool_name":"bash","audit.user_decision":"approved"}
 */
import type { Logger } from 'pino'

// ─────────────────────────────────────────────────────────────────────────────
// Attribute Names
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard audit attribute names.
 */
export const AuditAttributes = {
  /** Type of audit event */
  EVENT_TYPE: 'audit.event_type',

  /** Tool name for tool-related events */
  TOOL_NAME: 'audit.tool_name',

  /** User decision (approved/denied) */
  USER_DECISION: 'audit.user_decision',

  /** Session identifier */
  SESSION_ID: 'audit.session_id',

  /** Run identifier */
  RUN_ID: 'audit.run_id',

  /** Outcome of operation */
  OUTCOME: 'audit.outcome',

  /** Duration in milliseconds */
  DURATION_MS: 'audit.duration_ms',

  /** Error message if failed */
  ERROR: 'audit.error',

  /** Model name for LLM events */
  MODEL: 'audit.model',

  /** Token count */
  TOKENS: 'audit.tokens',
} as const

/**
 * Valid audit event types.
 */
export type AuditEventType =
  | 'session.started'
  | 'session.ended'
  | 'run.started'
  | 'run.ended'
  | 'tool.called'
  | 'tool.approved'
  | 'tool.denied'
  | 'tool.cached'
  | 'tool.succeeded'
  | 'tool.failed'
  | 'llm.request'
  | 'llm.response'
  | 'llm.error'
  | 'context.compacted'
  | 'interrupt.received'

// ─────────────────────────────────────────────────────────────────────────────
// Helper Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create audit log entry.
 */
function auditLog(
  logger: Logger,
  level: 'info' | 'warn' | 'error',
  eventType: AuditEventType,
  attributes: Record<string, unknown>,
  message: string,
): void {
  logger[level](
    {
      [AuditAttributes.EVENT_TYPE]: eventType,
      ...attributes,
    },
    message,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditSessionStarted(
  logger: Logger,
  sessionId: string,
  opts?: { resumed?: boolean },
): void {
  auditLog(
    logger,
    'info',
    'session.started',
    {
      [AuditAttributes.SESSION_ID]: sessionId,
      resumed: opts?.resumed ?? false,
    },
    'Session started',
  )
}

export function auditSessionEnded(logger: Logger, sessionId: string, durationMs: number): void {
  auditLog(
    logger,
    'info',
    'session.ended',
    {
      [AuditAttributes.SESSION_ID]: sessionId,
      [AuditAttributes.DURATION_MS]: durationMs,
    },
    'Session ended',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Run Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditRunStarted(logger: Logger, runId: string, promptLength: number): void {
  auditLog(
    logger,
    'info',
    'run.started',
    {
      [AuditAttributes.RUN_ID]: runId,
      'prompt.length': promptLength,
    },
    'Run started',
  )
}

export function auditRunEnded(
  logger: Logger,
  runId: string,
  outcome: 'success' | 'error' | 'interrupted' | 'max_steps',
  steps: number,
): void {
  auditLog(
    logger,
    'info',
    'run.ended',
    {
      [AuditAttributes.RUN_ID]: runId,
      [AuditAttributes.OUTCOME]: outcome,
      'run.steps': steps,
    },
    'Run ended',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditToolCalled(logger: Logger, toolName: string): void {
  auditLog(
    logger,
    'info',
    'tool.called',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
    },
    `Tool called: ${toolName}`,
  )
}

export function auditToolApproved(logger: Logger, toolName: string): void {
  auditLog(
    logger,
    'info',
    'tool.approved',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
      [AuditAttributes.USER_DECISION]: 'approved',
    },
    `Tool approved: ${toolName}`,
  )
}

export function auditToolDenied(logger: Logger, toolName: string): void {
  auditLog(
    logger,
    'warn',
    'tool.denied',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
      [AuditAttributes.USER_DECISION]: 'denied',
    },
    `Tool denied: ${toolName}`,
  )
}

export function auditToolCached(logger: Logger, toolName: string): void {
  auditLog(
    logger,
    'info',
    'tool.cached',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
      [AuditAttributes.OUTCOME]: 'cached',
    },
    `Tool approval cached: ${toolName}`,
  )
}

export function auditToolSucceeded(logger: Logger, toolName: string, durationMs: number): void {
  auditLog(
    logger,
    'info',
    'tool.succeeded',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
      [AuditAttributes.DURATION_MS]: durationMs,
      [AuditAttributes.OUTCOME]: 'success',
    },
    `Tool succeeded: ${toolName}`,
  )
}

export function auditToolFailed(logger: Logger, toolName: string, error: string): void {
  auditLog(
    logger,
    'warn',
    'tool.failed',
    {
      [AuditAttributes.TOOL_NAME]: toolName,
      [AuditAttributes.ERROR]: error,
      [AuditAttributes.OUTCOME]: 'error',
    },
    `Tool failed: ${toolName}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditLlmRequest(logger: Logger, model: string): void {
  auditLog(
    logger,
    'info',
    'llm.request',
    {
      [AuditAttributes.MODEL]: model,
    },
    'LLM request',
  )
}

export function auditLlmResponse(
  logger: Logger,
  model: string,
  tokens: number,
  durationMs: number,
): void {
  auditLog(
    logger,
    'info',
    'llm.response',
    {
      [AuditAttributes.MODEL]: model,
      [AuditAttributes.TOKENS]: tokens,
      [AuditAttributes.DURATION_MS]: durationMs,
    },
    'LLM response',
  )
}

export function auditLlmError(logger: Logger, model: string, error: string): void {
  auditLog(
    logger,
    'error',
    'llm.error',
    {
      [AuditAttributes.MODEL]: model,
      [AuditAttributes.ERROR]: error,
    },
    'LLM error',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditContextCompacted(
  logger: Logger,
  beforeChars: number,
  afterChars: number,
): void {
  auditLog(
    logger,
    'info',
    'context.compacted',
    {
      'context.before_chars': beforeChars,
      'context.after_chars': afterChars,
      'context.ratio': beforeChars > 0 ? afterChars / beforeChars : 0,
    },
    'Context compacted',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Interrupt Events
// ─────────────────────────────────────────────────────────────────────────────

export function auditInterruptReceived(logger: Logger, message: string): void {
  auditLog(
    logger,
    'info',
    'interrupt.received',
    {
      'interrupt.message': message,
    },
    'Interrupt received',
  )
}
