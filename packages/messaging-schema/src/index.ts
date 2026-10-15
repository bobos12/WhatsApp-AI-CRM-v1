/**
 * @crm/messaging-schema
 *
 * Canonical messaging types shared between backend and frontend.
 *
 * This package is intentionally types-only: zero runtime dependencies, no
 * business logic, no I/O. Validators, normalizers, compilers, and stores
 * live in the apps/ tree and depend on these types.
 *
 * Module map:
 *   - message.ts       NormalizedMessage (server-side canonical shape)
 *   - dto.ts           MessageDTO (wire shape — strips raw + reduces metadata)
 *   - content.ts       MessageContent discriminated union + MessageKind
 *   - media.ts         Media + MediaType
 *   - renderable.ts    RenderablePayload + RenderableBlock
 *   - status.ts        MessageStatus + MessageDirection
 *   - metadata.ts      MessageMetadata + MessageOrigin
 *   - compatibility.ts CompatibilityMode + CompatibilityReport
 *   - validation.ts    ValidationResult + ValidationIssue + ValidationContext
 *   - capability.ts    ProviderCapabilities + ButtonLimits + ListLimits
 *   - reply.ts         ReplyReference
 *   - reactions.ts     ReactionEvent (reactions are NOT messages)
 *   - events.ts        RealtimeEvent envelope + per-type payloads
 *   - provider.ts      ProviderName
 */

export * from './provider';
export * from './media';
export * from './provider-capabilities';
export * from './content';
export * from './reply';
export * from './reactions';
export * from './compatibility';
export * from './renderable';
export * from './status';
export * from './metadata';
export * from './capability';
export * from './validation';
export * from './message';
export * from './dto';
export * from './events';
export * from './upload-limits';
