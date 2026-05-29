export interface CallParticipantLike {
  id: string;
  name: string;
  avatarUrl?: string;
  jitsiParticipantId?: string;
}

function normalizeParticipantName(name: string): string {
  return name.trim().toLowerCase();
}

function participantsMatch(
  a: CallParticipantLike,
  b: CallParticipantLike,
): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (
    a.jitsiParticipantId &&
    b.jitsiParticipantId &&
    a.jitsiParticipantId === b.jitsiParticipantId
  ) {
    return true;
  }
  if (a.id && b.jitsiParticipantId && a.id === b.jitsiParticipantId) return true;
  if (b.id && a.jitsiParticipantId && b.id === a.jitsiParticipantId) return true;
  return normalizeParticipantName(a.name) === normalizeParticipantName(b.name);
}

function isProfileUserId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Merge remote call participants without duplicating profile + Jitsi-id entries. */
export function mergeCallParticipants(
  existing: CallParticipantLike[],
  incoming: CallParticipantLike,
): CallParticipantLike[] {
  const matchIndex = existing.findIndex((participant) => participantsMatch(participant, incoming));
  if (matchIndex === -1) {
    return [...existing, incoming];
  }

  const current = existing[matchIndex];
  const merged: CallParticipantLike = {
    ...current,
    ...incoming,
    id: isProfileUserId(current.id)
      ? current.id
      : isProfileUserId(incoming.id)
        ? incoming.id
        : current.id,
    avatarUrl: current.avatarUrl || incoming.avatarUrl,
    jitsiParticipantId: incoming.jitsiParticipantId || current.jitsiParticipantId,
  };

  const next = [...existing];
  next[matchIndex] = merged;
  return next;
}

export function dedupeCallParticipants(
  participants: CallParticipantLike[],
): CallParticipantLike[] {
  const deduped: CallParticipantLike[] = [];
  for (const participant of participants) {
    const merged = mergeCallParticipants(deduped, participant);
    if (merged.length === deduped.length) {
      deduped.push(participant);
    } else {
      deduped.splice(0, deduped.length, ...merged);
    }
  }
  return deduped;
}

/** Show remotes on the call stage when they are known (1:1 setup) or present in Jitsi. */
export function shouldShowOnCallStage(
  participant: CallParticipantLike & { isLocal?: boolean },
  remoteParticipantCount = 0,
): boolean {
  if (participant.isLocal) return true;
  if (participant.jitsiParticipantId) return true;
  if (isProfileUserId(participant.id)) return true;
  if (remoteParticipantCount > 0) return true;
  return false;
}

export function filterJoinedStageParticipants<
  T extends CallParticipantLike & { isLocal?: boolean },
>(participants: T[], remoteParticipantCount = 0): T[] {
  return participants.filter((participant) =>
    shouldShowOnCallStage(participant, remoteParticipantCount),
  );
}
