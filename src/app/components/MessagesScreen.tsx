import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useEdgeBackNavigation } from '../hooks/useEdgeBackNavigation';
import { useConversations } from '../hooks/useConversations';
import { ChatScreen } from './ChatScreen';
import { GroupThreadScreen } from './GroupThreadScreen';
import { GroupVoiceChannelScreen } from './GroupVoiceChannelScreen';
import { SharedProfileView } from './SharedProfileView';
import { supabase } from '../lib/supabase';
import { getCachedUser, initAuthSession, subscribeAuth } from '../lib/authSession';
import { debounce } from '../lib/requestThrottle';
import { api } from '../lib/api';
import { getOptimizedImageUrl } from '../lib/images';
import { User } from '../types';
import { useUnread } from '../context/UnreadContext';
import { useTranslation } from 'react-i18next';
import { toast } from '../lib/toast';
import { Plus, MessageCircle, Volume2, Hash, Link2, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { GroupChannelNavContext } from '../context/GroupChannelNavContext';
import { useCall } from '../context/CallContext';
import {
  formatGroupTypingLabel,
  subscribeGroupTypingBroadcast,
} from '../lib/groupTypingBroadcast';
import { NotificationBadge, NotificationBadgeInline } from './NotificationBadge';
import {
  ConversationActionsMenu,
  openConversationActionsMenuFromEvent,
  type ConversationActionTarget,
} from './ConversationActionsMenu';
import {
  GroupActionsMenu,
  openGroupActionsMenuFromEvent,
  type GroupActionTarget,
} from './GroupActionsMenu';
import { useLongPress } from '../hooks/useLongPress';
import { NotificationManager } from '../lib/notifications';
import {
  prefetchDmMessages,
  prefetchGroupChannelMessages,
  prefetchGroupChannels,
  prefetchRecentDmMessages,
  prefetchAllGroupChannels,
  fetchGroupChannels,
  groupChannelsQueryKey,
} from '../lib/chatMessages';
import type { Conversation } from '../hooks/useChat';

function groupAccentHue(groupId: string): number {
  let h = 0;
  for (let i = 0; i < groupId.length; i += 1) h += groupId.charCodeAt(i);
  return 200 + (h % 140);
}

const VOICE_AVATAR_STACK_MAX = 5;

interface VoicePresenceProfile {
  id?: string;
  avatar_url?: string | null;
  display_name?: string | null;
  name?: string | null;
  username?: string | null;
}

interface VoicePresenceParticipant {
  user_id: string;
  profiles?: VoicePresenceProfile | null;
}

function voiceParticipantLabel(participant: VoicePresenceParticipant): string {
  const profile = participant.profiles;
  return profile?.display_name || profile?.name || profile?.username || '?';
}

function normalizeVoiceParticipants(raw: unknown): VoicePresenceParticipant[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const entry = row as { user_id?: string; profiles?: VoicePresenceProfile | VoicePresenceProfile[] | null };
    const profiles = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles;
    return {
      user_id: String(entry.user_id || profiles?.id || ''),
      profiles: profiles ?? null,
    };
  }).filter((p) => p.user_id);
}

function VoiceChannelAvatarStack({ participants }: { participants: VoicePresenceParticipant[] }) {
  if (participants.length === 0) return null;

  const visible = participants.slice(0, VOICE_AVATAR_STACK_MAX);
  const overflow = participants.length - visible.length;

  return (
    <div className="flex items-center shrink-0 pl-1">
      {visible.map((participant, index) => {
        const label = voiceParticipantLabel(participant);
        const avatarUrl = participant.profiles?.avatar_url
          ? getOptimizedImageUrl(participant.profiles.avatar_url, 48)
          : null;
        return (
          <div
            key={participant.user_id}
            title={label}
            className="relative w-6 h-6 rounded-full border-2 border-white dark:border-[#111] bg-gray-200 dark:bg-gray-700 overflow-hidden shrink-0"
            style={{
              marginLeft: index === 0 ? 0 : -8,
              zIndex: visible.length - index,
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                {label.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
      {overflow > 0 ? (
        <div
          title={`+${overflow}`}
          className="relative flex h-6 min-w-[1.5rem] px-1 rounded-full border-2 border-white dark:border-[#111] bg-[#23a559] text-white items-center justify-center shrink-0 text-[10px] font-bold"
          style={{ marginLeft: -8, zIndex: 0 }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}

interface FriendProfile {
  id: string;
  display_name?: string | null;
  name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  images?: string[] | null;
}

interface IncomingFriendRequest {
  id: string;
  user_id: string;
  requester?: FriendProfile;
}

interface GroupRow {
  id: string;
  name: string;
  description?: string | null;
  is_private?: boolean;
  icon_url?: string | null;
}

interface MyGroupMembership {
  id: string;
  role: string;
  joined_at: string;
  group: GroupRow | null;
}

interface GroupChannelRow {
  id: string;
  group_id: string;
  name: string;
  position: number;
  type?: 'text' | 'voice';
  icon_url?: string | null;
}

const EMPTY_GROUP_CHANNELS: GroupChannelRow[] = [];

export function MessagesScreen() {
  const { t, i18n } = useTranslation();
  const { unreadByConversation } = useUnread();
  const dmUnreadTotal = React.useMemo(
    () => Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0),
    [unreadByConversation]
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedOtherUser, setSelectedOtherUser] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profilePreviewUserId, setProfilePreviewUserId] = useState<string | null>(null);
  const [profilePreviewData, setProfilePreviewData] = useState<User | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [friendUsernameInput, setFriendUsernameInput] = useState('');
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string; icon_url?: string | null } | null>(null);
  const [showGroupActionModal, setShowGroupActionModal] = useState(false);
  const [groupActionTab, setGroupActionTab] = useState<'create' | 'join'>('create');
  const [groupUnreadById, setGroupUnreadById] = useState<Record<string, number>>({});
  const [channelUnreadById, setChannelUnreadById] = useState<Record<string, number>>({});
  const [myGroupRows, setMyGroupRows] = useState<MyGroupMembership[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [createGroupName, setCreateGroupName] = useState('');
  const [createGroupDescription, setCreateGroupDescription] = useState('');
  const [createGroupPrivate, setCreateGroupPrivate] = useState(false);
  const [createGroupIconFile, setCreateGroupIconFile] = useState<File | null>(null);
  const [createGroupIconPreview, setCreateGroupIconPreview] = useState<string | null>(null);
  const groupIconInputRef = useRef<HTMLInputElement>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
  const [newChannelIconFile, setNewChannelIconFile] = useState<File | null>(null);
  const [newChannelIconPreview, setNewChannelIconPreview] = useState<string | null>(null);
  const channelIconInputRef = useRef<HTMLInputElement>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [showEditChannelModal, setShowEditChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<GroupChannelRow | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelIconFile, setEditChannelIconFile] = useState<File | null>(null);
  const [editChannelIconPreview, setEditChannelIconPreview] = useState<string | null>(null);
  const [editChannelIconCleared, setEditChannelIconCleared] = useState(false);
  const editChannelIconInputRef = useRef<HTMLInputElement>(null);
  const [updatingChannel, setUpdatingChannel] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [groupInvite, setGroupInvite] = useState<{ code: string; url?: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [refreshingInvite, setRefreshingInvite] = useState(false);
  const [joinInviteInput, setJoinInviteInput] = useState('');
  const [joiningViaInvite, setJoiningViaInvite] = useState(false);
  const [voicePresenceByChannel, setVoicePresenceByChannel] = useState<Record<string, VoicePresenceParticipant[]>>({});
  const [typingNamesByChannelId, setTypingNamesByChannelId] = useState<Record<string, string[]>>({});
  const [conversationActionsMenu, setConversationActionsMenu] = useState<ConversationActionTarget | null>(null);
  const [groupActionsMenu, setGroupActionsMenu] = useState<GroupActionTarget | null>(null);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDescription, setEditGroupDescription] = useState('');
  const [editGroupPrivate, setEditGroupPrivate] = useState(false);
  const [editGroupIconFile, setEditGroupIconFile] = useState<File | null>(null);
  const [editGroupIconPreview, setEditGroupIconPreview] = useState<string | null>(null);
  const [editGroupIconCleared, setEditGroupIconCleared] = useState(false);
  const editGroupIconInputRef = useRef<HTMLInputElement>(null);
  const [updatingGroup, setUpdatingGroup] = useState(false);
  const [inviteTargetGroupId, setInviteTargetGroupId] = useState<string | null>(null);

  const { conversations, loading, error, reload } = useConversations();
  const queryClient = useQueryClient();
  const selectedGroupId = selectedGroup?.id ?? null;

  const {
    data: groupChannels = EMPTY_GROUP_CHANNELS,
    isPending: channelsLoading,
  } = useQuery({
    queryKey: groupChannelsQueryKey(selectedGroupId!),
    enabled: !!selectedGroupId,
    queryFn: () => fetchGroupChannels(selectedGroupId!),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const patchGroupChannels = React.useCallback(
    (groupId: string, updater: (prev: GroupChannelRow[]) => GroupChannelRow[]) => {
      queryClient.setQueryData<GroupChannelRow[]>(groupChannelsQueryKey(groupId), (prev) =>
        updater(prev ?? [])
      );
    },
    [queryClient]
  );

  const {
    enterCallPip,
    isCallForConversation,
    joinVoiceChannel,
    isVoiceChannelActive,
    activeCall,
    hangUp,
    state: callState,
    openCallInGroupPanel,
    callDisplayMode,
    callPinned,
  } = useCall();
  const [typingByConversation, setTypingByConversation] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const handleTypingStatus = (event: Event) => {
      const { conversationId, isTyping } = (event as CustomEvent<{ conversationId: string; isTyping: boolean }>)
        .detail;
      if (!conversationId) return;
      setTypingByConversation((prev) => {
        if (prev[conversationId] === isTyping) return prev;
        if (!isTyping) {
          const next = { ...prev };
          delete next[conversationId];
          return next;
        }
        return { ...prev, [conversationId]: true };
      });
    };

    window.addEventListener('typing-status-changed', handleTypingStatus);
    return () => window.removeEventListener('typing-status-changed', handleTypingStatus);
  }, []);

  const topConversationIdsKey = useMemo(
    () =>
      conversations
        .slice(0, 5)
        .map((conversation) => conversation.id)
        .join(','),
    [conversations]
  );

  React.useEffect(() => {
    if (!topConversationIdsKey) return;
    prefetchRecentDmMessages(queryClient, topConversationIdsKey.split(','));
  }, [topConversationIdsKey, queryClient]);

  const myGroupIdsKey = useMemo(
    () =>
      myGroupRows
        .map((row) => row.group?.id)
        .filter((id): id is string => Boolean(id))
        .join(','),
    [myGroupRows]
  );

  React.useEffect(() => {
    if (!myGroupIdsKey) return;
    prefetchAllGroupChannels(queryClient, myGroupIdsKey.split(','));
  }, [myGroupIdsKey, queryClient]);

  const isConversationTyping = React.useCallback(
    (conversationId: string) => Boolean(typingByConversation[conversationId]),
    [typingByConversation]
  );
  const handleLeaveChat = React.useCallback(
    (conversationId: string) => {
      if (
        callState === 'in_call' &&
        isCallForConversation(conversationId) &&
        !callPinned
      ) {
        enterCallPip();
      }
      setSelectedConversationId(null);
      setSelectedOtherUser(null);
      lastPushedChatIdRef.current = null;
    },
    [callPinned, callState, enterCallPip, isCallForConversation]
  );

  const openGroupActions = React.useCallback(
    (event: React.MouseEvent | React.PointerEvent, group: GroupRow) => {
      event.preventDefault();
      event.stopPropagation();
      const row = myGroupRows.find((entry) => entry.group?.id === group.id);
      setGroupActionsMenu(
        openGroupActionsMenuFromEvent(event, group, row?.role === 'admin')
      );
    },
    [myGroupRows]
  );

  useEffect(() => {
    NotificationManager.setActiveGroupId(selectedGroup?.id ?? null);
  }, [selectedGroup?.id]);

  const openConversationActions = React.useCallback(
    (
      event: React.MouseEvent | React.PointerEvent,
      conversationId: string,
      otherUser: ConversationActionTarget['otherUser']
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setConversationActionsMenu(openConversationActionsMenuFromEvent(event, conversationId, otherUser));
    },
    []
  );

  const handleRemoveFriend = React.useCallback(
    async (target: ConversationActionTarget) => {
      const confirmed = window.confirm(
        t('chat.deleteFriendConfirm', { name: target.otherUser.name })
      );
      if (!confirmed) return;

      try {
        await api.removeFriend(target.otherUser.id);
        toast.success(t('chat.deleteFriendSuccess'));
        if (selectedConversationId === target.conversationId) {
          handleLeaveChat(target.conversationId);
        }
        await reload();
      } catch (err: any) {
        toast.error(
          t('chat.deleteFriendFailedTitle'),
          err?.message || t('chat.deleteFriendFailedTitle')
        );
      }
    },
    [handleLeaveChat, reload, selectedConversationId, t]
  );

  const handleBlockFriendFromMenu = React.useCallback(
    async (target: ConversationActionTarget) => {
      const confirmed = window.confirm(t('chat.blockUserConfirm'));
      if (!confirmed) return;

      try {
        await api.blockUser(target.otherUser.id);
        toast.success(t('chat.blockSuccess'));
        handleLeaveChat(target.conversationId);
        await reload();
      } catch (err: any) {
        toast.error(t('chat.blockFailedTitle'), err?.message || t('chat.blockFailedTitle'));
      }
    },
    [handleLeaveChat, reload, t]
  );
  const lastPushedChatIdRef = useRef<string | null>(null);
  const lastPushedGroupIdRef = useRef<string | null>(null);
  const lastPushedVoiceKeyRef = useRef<string | null>(null);
  const pendingConversationIdRef = useRef<string | null>(null);

  const openConversationById = React.useCallback((conversationId: string) => {
    setSelectedGroup(null);
    setSelectedChannelId(null);
    lastPushedGroupIdRef.current = null;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) {
      pendingConversationIdRef.current = conversationId;
      return;
    }
    pendingConversationIdRef.current = null;
    const otherUser = conv.other_user;
    const imageUrl = otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : undefined;
    setSelectedConversationId(conv.id);
    setSelectedOtherUser({
      id: otherUser.id,
      name: otherUser.name,
      display_name: otherUser.display_name,
      username: otherUser.username,
      imageUrl,
      is_online: otherUser.is_online,
      age: otherUser.age,
    });
  }, [conversations]);

  const loadFriends = React.useCallback(async () => {
    try {
      setFriendsLoading(true);
      const data = await api.getFriends();
      setIncomingRequests((data?.incoming_requests || []) as IncomingFriendRequest[]);
    } catch (err: any) {
      console.error('Failed to load friends:', err);
      toast.error(t('chat.friendsLoadFailedTitle'), err?.message || t('chat.friendsLoadFailedBody'));
    } finally {
      setFriendsLoading(false);
    }
  }, [t]);

  const ensureConversationAndOpen = React.useCallback(async (otherUserId: string) => {
    if (!currentUserId) return;
    const user1Id = currentUserId < otherUserId ? currentUserId : otherUserId;
    const user2Id = currentUserId < otherUserId ? otherUserId : currentUserId;

    const { data: existingConv, error: existingError } = await supabase
      .from('conversations')
      .select('id')
      .eq('user1_id', user1Id)
      .eq('user2_id', user2Id)
      .maybeSingle();
    if (existingError) throw existingError;

    let conversationId = existingConv?.id;
    if (!conversationId) {
      const { data: createdConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          user1_id: user1Id,
          user2_id: user2Id,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (createError) throw createError;
      conversationId = createdConv?.id;
    }

    if (conversationId) {
      pendingConversationIdRef.current = conversationId;
      await reload();
      openConversationById(conversationId);
    }
  }, [currentUserId, openConversationById, reload]);

  const handleSendFriendRequest = React.useCallback(async () => {
    const username = friendUsernameInput.trim().replace(/^@/, '');
    if (!username) {
      toast.error(t('chat.usernameMissingTitle'), t('chat.usernameMissingBody'));
      return;
    }

    try {
      setSendingRequest(true);
      await api.sendFriendRequest(username);
      toast.success(t('chat.friendRequestSent'));
      setFriendUsernameInput('');
      await loadFriends();
    } catch (err: any) {
      toast.error(t('chat.friendRequestFailedTitle'), err?.message || t('chat.friendRequestFailedBody'));
    } finally {
      setSendingRequest(false);
    }
  }, [friendUsernameInput, loadFriends, t]);

  const handleRespondRequest = React.useCallback(async (requestId: string, action: 'accept' | 'decline') => {
    try {
      const response = await api.respondToFriendRequest(requestId, action);
      await loadFriends();

      if (action === 'accept') {
        if (response?.friend_user_id) {
          await ensureConversationAndOpen(response.friend_user_id);
        } else {
          await reload();
        }
        toast.success(t('chat.friendAdded'));
      } else {
        await reload();
        toast.success(t('chat.requestDeclined'));
      }
    } catch (err: any) {
      toast.error(t('chat.requestHandleFailedTitle'), err?.message || t('chat.requestHandleFailedBody'));
    }
  }, [ensureConversationAndOpen, loadFriends, reload, t]);

  const loadGroupsData = React.useCallback(async () => {
    try {
      setGroupsLoading(true);
      const mine = await api.getMyGroups();
      setMyGroupRows((mine?.groups || []) as MyGroupMembership[]);
    } catch (err: any) {
      toast.error(t('groups.loadListFailedTitle'), err?.message || t('groups.loadListFailedBody'));
    } finally {
      setGroupsLoading(false);
    }
  }, [t]);

  const handleCreateGroup = React.useCallback(async () => {
    const name = createGroupName.trim();
    if (name.length < 2) {
      toast.error(t('groups.createFailedTitle'), t('groups.namePlaceholder'));
      return;
    }
    try {
      setCreatingGroup(true);
      let iconUrl: string | null = null;
      if (createGroupIconFile) {
        iconUrl = await api.uploadGroupIcon(createGroupIconFile);
      }
      await api.createGroup({
        name,
        description: createGroupDescription.trim() || null,
        is_private: createGroupPrivate,
        iconUrl,
      });
      toast.success(t('groups.created'));
      setCreateGroupName('');
      setCreateGroupDescription('');
      setCreateGroupPrivate(false);
      setCreateGroupIconFile(null);
      setCreateGroupIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
      if (groupIconInputRef.current) groupIconInputRef.current.value = '';
      await loadGroupsData();
      setShowGroupActionModal(false);
    } catch (err: any) {
      toast.error(t('groups.createFailedTitle'), err?.message || t('groups.createFailedBody'));
    } finally {
      setCreatingGroup(false);
    }
  }, [createGroupDescription, createGroupIconFile, createGroupName, createGroupPrivate, loadGroupsData, t]);

  const handleCreateGroupIconChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error(t('groups.createFailedTitle'), t('groups.groupIconInvalid'));
        return;
      }
      setCreateGroupIconFile(file);
      setCreateGroupIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [t]
  );

  const clearCreateGroupIcon = React.useCallback(() => {
    setCreateGroupIconFile(null);
    setCreateGroupIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (groupIconInputRef.current) groupIconInputRef.current.value = '';
  }, []);

  const isSelectedGroupAdmin = useMemo(() => {
    if (!selectedGroup?.id) return false;
    const row = myGroupRows.find((entry) => entry.group?.id === selectedGroup.id);
    return row?.role === 'admin';
  }, [myGroupRows, selectedGroup?.id]);

  const inviteGroupAdmin = useMemo(() => {
    const groupId = inviteTargetGroupId ?? selectedGroup?.id;
    if (!groupId) return false;
    const row = myGroupRows.find((entry) => entry.group?.id === groupId);
    return row?.role === 'admin';
  }, [inviteTargetGroupId, myGroupRows, selectedGroup?.id]);

  const openEditGroupModal = React.useCallback((target: GroupActionTarget) => {
    setEditingGroupId(target.groupId);
    setEditGroupName(target.groupName);
    setEditGroupDescription(target.description?.trim() ?? '');
    setEditGroupPrivate(Boolean(target.isPrivate));
    setEditGroupIconFile(null);
    setEditGroupIconCleared(false);
    setEditGroupIconPreview(
      target.iconUrl ? getOptimizedImageUrl(target.iconUrl, 200) : null
    );
    if (editGroupIconInputRef.current) editGroupIconInputRef.current.value = '';
    setShowEditGroupModal(true);
  }, []);

  const closeEditGroupModal = React.useCallback(() => {
    setShowEditGroupModal(false);
    setEditingGroupId(null);
    setEditGroupName('');
    setEditGroupDescription('');
    setEditGroupPrivate(false);
    setEditGroupIconFile(null);
    setEditGroupIconCleared(false);
    setEditGroupIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (editGroupIconInputRef.current) editGroupIconInputRef.current.value = '';
  }, []);

  const handleEditGroupIconChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error(t('groups.updateGroupFailedTitle'), t('groups.groupIconInvalid'));
        return;
      }
      setEditGroupIconFile(file);
      setEditGroupIconCleared(false);
      setEditGroupIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [t]
  );

  const clearEditGroupIcon = React.useCallback(() => {
    setEditGroupIconFile(null);
    setEditGroupIconCleared(true);
    setEditGroupIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (editGroupIconInputRef.current) editGroupIconInputRef.current.value = '';
  }, []);

  const handleUpdateGroup = React.useCallback(async () => {
    if (!editingGroupId) return;
    const name = editGroupName.trim();
    if (name.length < 2) {
      toast.error(t('groups.updateGroupFailedTitle'), t('groups.namePlaceholder'));
      return;
    }
    try {
      setUpdatingGroup(true);
      let iconUrl: string | null | undefined;
      if (editGroupIconFile) {
        iconUrl = await api.uploadGroupIcon(editGroupIconFile);
      } else if (editGroupIconCleared) {
        iconUrl = null;
      }
      const data = await api.updateGroup(editingGroupId, {
        name,
        description: editGroupDescription.trim() || null,
        is_private: editGroupPrivate,
        ...(iconUrl !== undefined ? { iconUrl } : {}),
      });
      const updated = data?.group as GroupRow | undefined;
      toast.success(t('groups.groupUpdated'));
      if (selectedGroup?.id === editingGroupId) {
        setSelectedGroup({
          id: editingGroupId,
          name: updated?.name ?? name,
          icon_url: updated?.icon_url ?? (iconUrl === null ? null : selectedGroup.icon_url),
        });
      }
      await loadGroupsData();
      closeEditGroupModal();
    } catch (err: any) {
      toast.error(t('groups.updateGroupFailedTitle'), err?.message || t('groups.updateGroupFailedBody'));
    } finally {
      setUpdatingGroup(false);
    }
  }, [
    closeEditGroupModal,
    editGroupDescription,
    editGroupIconCleared,
    editGroupIconFile,
    editGroupName,
    editGroupPrivate,
    editingGroupId,
    loadGroupsData,
    selectedGroup,
    t,
  ]);

  const handleLeaveGroupFromMenu = React.useCallback(
    async (target: GroupActionTarget) => {
      if (!window.confirm(t('groups.leaveConfirm', { name: target.groupName }))) return;
      try {
        await api.leaveGroup(target.groupId);
        toast.success(t('groups.leftGroup'));
        if (selectedGroup?.id === target.groupId) {
          setSelectedGroup(null);
          setSelectedChannelId(null);
          lastPushedGroupIdRef.current = null;
        }
        await loadGroupsData();
      } catch (err: any) {
        toast.error(t('groups.leaveFailedTitle'), err?.message || t('groups.leaveFailedBody'));
      }
    },
    [loadGroupsData, selectedGroup?.id, t]
  );

  const handleDeleteGroupFromMenu = React.useCallback(
    async (target: GroupActionTarget) => {
      if (!window.confirm(t('groups.deleteGroupConfirm', { name: target.groupName }))) return;
      try {
        await api.deleteGroup(target.groupId);
        toast.success(t('groups.groupDeleted'));
        if (selectedGroup?.id === target.groupId) {
          setSelectedGroup(null);
          setSelectedChannelId(null);
          lastPushedGroupIdRef.current = null;
        }
        queryClient.removeQueries({ queryKey: groupChannelsQueryKey(target.groupId) });
        await loadGroupsData();
      } catch (err: any) {
        toast.error(t('groups.deleteGroupFailedTitle'), err?.message || t('groups.deleteGroupFailedBody'));
      }
    },
    [loadGroupsData, queryClient, selectedGroup?.id, t]
  );

  const openGroupInviteModal = React.useCallback((groupId?: string) => {
    setInviteTargetGroupId(groupId ?? null);
    setShowInviteModal(true);
  }, []);

  const textChannels = useMemo(
    () => groupChannels.filter((ch) => (ch.type ?? 'text') === 'text'),
    [groupChannels]
  );
  const voiceChannels = useMemo(
    () => groupChannels.filter((ch) => ch.type === 'voice'),
    [groupChannels]
  );
  const voiceChannelIdsKey = useMemo(
    () => voiceChannels.map((ch) => ch.id).join(','),
    [voiceChannels]
  );

  const selectedChannel = useMemo(
    () => groupChannels.find((c) => c.id === selectedChannelId) ?? null,
    [groupChannels, selectedChannelId]
  );

  const reloadVoicePresence = React.useCallback(async () => {
    if (!selectedGroup?.id || voiceChannels.length === 0) {
      setVoicePresenceByChannel((prev) =>
        Object.keys(prev).length === 0 ? prev : {}
      );
      return;
    }
    const next: Record<string, VoicePresenceParticipant[]> = {};
    await Promise.all(
      voiceChannels.map(async (channel) => {
        try {
          const data = await api.getVoiceChannelState(selectedGroup.id, channel.id);
          next[channel.id] = normalizeVoiceParticipants(data?.participants);
        } catch {
          next[channel.id] = [];
        }
      })
    );
    setVoicePresenceByChannel(next);
  }, [selectedGroup?.id, voiceChannelIdsKey, voiceChannels]);

  const debouncedReloadVoicePresence = useMemo(
    () =>
      debounce(() => {
        void reloadVoicePresence();
      }, 500),
    [reloadVoicePresence]
  );

  const handleCreateChannel = React.useCallback(async () => {
    if (!selectedGroup?.id) return;
    const name = newChannelName.trim();
    if (!name) {
      toast.error(t('groups.createChannelFailedTitle'), t('groups.channelNamePlaceholder'));
      return;
    }
    try {
      setCreatingChannel(true);
      let iconUrl: string | null = null;
      if (newChannelIconFile) {
        iconUrl = await api.uploadChannelIcon(selectedGroup.id, newChannelIconFile);
      }
      const data = await api.createGroupChannel(selectedGroup.id, {
        name,
        type: newChannelType,
        iconUrl,
      });
      const channel = data?.channel as GroupChannelRow | undefined;
      if (channel) {
        patchGroupChannels(selectedGroup.id, (prev) =>
          [...prev, channel].sort((a, b) => a.position - b.position)
        );
        if (channel.type === 'text') setSelectedChannelId(channel.id);
      }
      toast.success(t('groups.channelCreated'));
      setNewChannelName('');
      setNewChannelType('text');
      setNewChannelIconFile(null);
      setNewChannelIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
      if (channelIconInputRef.current) channelIconInputRef.current.value = '';
      setShowCreateChannelModal(false);
      await reloadVoicePresence();
    } catch (err: any) {
      toast.error(t('groups.createChannelFailedTitle'), err?.message || t('groups.createChannelFailedBody'));
    } finally {
      setCreatingChannel(false);
    }
  }, [newChannelIconFile, newChannelName, newChannelType, patchGroupChannels, reloadVoicePresence, selectedGroup?.id, t]);

  const handleNewChannelIconChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error(t('groups.createChannelFailedTitle'), t('groups.channelIconInvalid'));
        return;
      }
      setNewChannelIconFile(file);
      setNewChannelIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [t]
  );

  const clearNewChannelIcon = React.useCallback(() => {
    setNewChannelIconFile(null);
    setNewChannelIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (channelIconInputRef.current) channelIconInputRef.current.value = '';
  }, []);

  const clearEditChannelIcon = React.useCallback(() => {
    setEditChannelIconFile(null);
    setEditChannelIconCleared(true);
    setEditChannelIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (editChannelIconInputRef.current) editChannelIconInputRef.current.value = '';
  }, []);

  const openEditChannelModal = React.useCallback((channel: GroupChannelRow) => {
    setEditingChannel(channel);
    setEditChannelName(channel.name);
    setEditChannelIconFile(null);
    setEditChannelIconCleared(false);
    setEditChannelIconPreview(
      channel.icon_url ? getOptimizedImageUrl(channel.icon_url, 120) : null
    );
    if (editChannelIconInputRef.current) editChannelIconInputRef.current.value = '';
    setShowEditChannelModal(true);
  }, []);

  const closeEditChannelModal = React.useCallback(() => {
    setShowEditChannelModal(false);
    setEditingChannel(null);
    setEditChannelName('');
    setEditChannelIconFile(null);
    setEditChannelIconCleared(false);
    setEditChannelIconPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    if (editChannelIconInputRef.current) editChannelIconInputRef.current.value = '';
  }, []);

  const handleEditChannelIconChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error(t('groups.updateChannelFailedTitle'), t('groups.channelIconInvalid'));
        return;
      }
      setEditChannelIconFile(file);
      setEditChannelIconCleared(false);
      setEditChannelIconPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [t]
  );

  const handleUpdateChannel = React.useCallback(async () => {
    if (!selectedGroup?.id || !editingChannel) return;
    const name = editChannelName.trim();
    if (!name) {
      toast.error(t('groups.updateChannelFailedTitle'), t('groups.channelNamePlaceholder'));
      return;
    }
    try {
      setUpdatingChannel(true);
      let iconUrl: string | null | undefined;
      if (editChannelIconFile) {
        iconUrl = await api.uploadChannelIcon(selectedGroup.id, editChannelIconFile);
      } else if (editChannelIconCleared) {
        iconUrl = null;
      }
      const data = await api.updateGroupChannel(selectedGroup.id, editingChannel.id, {
        name,
        ...(iconUrl !== undefined ? { iconUrl } : {}),
      });
      const channel = data?.channel as GroupChannelRow | undefined;
      if (channel) {
        patchGroupChannels(selectedGroup.id, (prev) =>
          prev
            .map((entry) => (entry.id === channel.id ? channel : entry))
            .sort((a, b) => a.position - b.position)
        );
      }
      toast.success(t('groups.channelUpdated'));
      closeEditChannelModal();
    } catch (err: any) {
      toast.error(t('groups.updateChannelFailedTitle'), err?.message || t('groups.updateChannelFailedBody'));
    } finally {
      setUpdatingChannel(false);
    }
  }, [
    closeEditChannelModal,
    editChannelIconCleared,
    editChannelIconFile,
    editChannelName,
    editingChannel,
    patchGroupChannels,
    selectedGroup?.id,
    t,
  ]);

  const handleDeleteChannel = React.useCallback(async () => {
    if (!selectedGroup?.id || !editingChannel) return;
    if (editingChannel.name === 'general' && (editingChannel.type ?? 'text') === 'text') {
      toast.error(t('groups.deleteChannelFailedTitle'), t('groups.cannotDeleteGeneralChannel'));
      return;
    }
    if (!window.confirm(t('groups.deleteChannelConfirm', { name: editingChannel.name }))) return;
    try {
      setDeletingChannel(true);
      await api.deleteGroupChannel(selectedGroup.id, editingChannel.id);
      patchGroupChannels(selectedGroup.id, (prev) =>
        prev.filter((entry) => entry.id !== editingChannel.id)
      );
      if (selectedChannelId === editingChannel.id) {
        const fallback = groupChannels.find(
          (entry) => entry.id !== editingChannel.id && (entry.type ?? 'text') === 'text'
        );
        setSelectedChannelId(fallback?.id ?? null);
      }
      toast.success(t('groups.channelDeleted'));
      closeEditChannelModal();
      await reloadVoicePresence();
    } catch (err: any) {
      toast.error(t('groups.deleteChannelFailedTitle'), err?.message || t('groups.deleteChannelFailedBody'));
    } finally {
      setDeletingChannel(false);
    }
  }, [
    closeEditChannelModal,
    editingChannel,
    groupChannels,
    patchGroupChannels,
    reloadVoicePresence,
    selectedChannelId,
    selectedGroup?.id,
    t,
  ]);

  const loadGroupInvite = React.useCallback(async () => {
    const groupId = inviteTargetGroupId ?? selectedGroup?.id;
    if (!groupId) return;
    try {
      setInviteLoading(true);
      const data = await api.getGroupInvite(groupId);
      setGroupInvite({
        code: String(data?.inviteCode || ''),
        url: data?.inviteUrl ? String(data.inviteUrl) : undefined,
      });
    } catch (err: any) {
      toast.error(t('groups.inviteFailedTitle'), err?.message || t('groups.inviteFailedBody'));
      setGroupInvite(null);
    } finally {
      setInviteLoading(false);
    }
  }, [inviteTargetGroupId, selectedGroup?.id, t]);

  const handleRefreshInvite = React.useCallback(async () => {
    const groupId = inviteTargetGroupId ?? selectedGroup?.id;
    if (!groupId || !inviteGroupAdmin) return;
    if (!window.confirm(t('groups.refreshInviteConfirm'))) return;
    try {
      setRefreshingInvite(true);
      const data = await api.refreshGroupInvite(groupId);
      setGroupInvite({
        code: String(data?.inviteCode || ''),
        url: data?.inviteUrl ? String(data.inviteUrl) : undefined,
      });
      toast.success(t('groups.inviteRefreshed'));
    } catch (err: any) {
      toast.error(t('groups.inviteFailedTitle'), err?.message || t('groups.inviteFailedBody'));
    } finally {
      setRefreshingInvite(false);
    }
  }, [inviteGroupAdmin, inviteTargetGroupId, selectedGroup?.id, t]);

  useEffect(() => {
    const groupId = inviteTargetGroupId ?? selectedGroup?.id;
    if (!showInviteModal || !groupId) return;
    void loadGroupInvite();
  }, [inviteTargetGroupId, loadGroupInvite, selectedGroup?.id, showInviteModal]);

  const handleJoinViaInvite = React.useCallback(async () => {
    const code = joinInviteInput.trim();
    if (!code) return;
    try {
      setJoiningViaInvite(true);
      const data = await api.joinGroupViaInvite(code);
      toast.success(t('groups.joined'));
      setJoinInviteInput('');
      setShowGroupActionModal(false);
      await loadGroupsData();
      if (data?.group?.id) {
        setSelectedGroup({ id: data.group.id, name: data.group.name, icon_url: data.group.icon_url ?? null });
      }
    } catch (err: any) {
      toast.error(t('groups.joinFailedTitle'), err?.message || t('groups.joinFailedBody'));
    } finally {
      setJoiningViaInvite(false);
    }
  }, [joinInviteInput, loadGroupsData, t]);

  const handleVoiceChannelClick = React.useCallback(
    async (channel: GroupChannelRow) => {
      if (!selectedGroup) return;
      if (isVoiceChannelActive(selectedGroup.id, channel.id)) {
        openCallInGroupPanel();
        return;
      }
      try {
        await joinVoiceChannel({
          groupId: selectedGroup.id,
          channelId: channel.id,
          channelName: channel.name,
          groupName: selectedGroup.name,
        });
        await reloadVoicePresence();
        openCallInGroupPanel();
      } catch (err: any) {
        toast.error(t('groups.voiceJoinFailedTitle'), err?.message || t('groups.voiceJoinFailedBody'));
      }
    },
    [
      isVoiceChannelActive,
      joinVoiceChannel,
      openCallInGroupPanel,
      reloadVoicePresence,
      selectedGroup,
      t,
    ]
  );

  const renderChannelLeadingIcon = React.useCallback(
    (ch: GroupChannelRow, fallback: React.ReactNode) => {
      if (ch.icon_url) {
        return (
          <img
            src={getOptimizedImageUrl(ch.icon_url, 80)}
            alt=""
            className="w-5 h-5 rounded-full object-cover shrink-0"
          />
        );
      }
      return fallback;
    },
    []
  );

  const renderChannelRow = React.useCallback(
    (ch: GroupChannelRow) => {
      const editButton = isSelectedGroupAdmin ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openEditChannelModal(ch);
          }}
          title={t('groups.editChannel')}
          className="shrink-0 rounded p-1 mr-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/10 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      ) : null;

      const isVoice = ch.type === 'voice';
      if (isVoice) {
        const participants = voicePresenceByChannel[ch.id] || [];
        const isActive = selectedGroup ? isVoiceChannelActive(selectedGroup.id, ch.id) : false;
        return (
          <div key={ch.id} className="group flex items-center">
            <button
              type="button"
              onClick={() => void handleVoiceChannelClick(ch)}
              className={`flex-1 min-w-0 text-left px-4 py-2 flex items-center justify-between gap-2 transition-colors ${
                isActive ? 'bg-[#23a559]/15 text-[#23a559]' : 'hover:bg-gray-50 dark:hover:bg-gray-900/80'
              }`}
            >
              <span className="text-sm font-medium truncate flex items-center gap-1.5 text-gray-900 dark:text-white min-w-0">
                {renderChannelLeadingIcon(
                  ch,
                  <Volume2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
                )}
                {ch.name}
              </span>
              <VoiceChannelAvatarStack participants={participants} />
            </button>
            {editButton}
          </div>
        );
      }

      const unread = channelUnreadById[ch.id] || 0;
      const typingNames = typingNamesByChannelId[ch.id] || [];
      const typingPreview = typingNames.length > 0 ? formatGroupTypingLabel(typingNames, t) : null;
      const isChSelected = ch.id === selectedChannelId;
      return (
        <div key={ch.id} className="group flex items-center">
          <button
            type="button"
            onPointerDown={() => {
              if (selectedGroup?.id) {
                void prefetchGroupChannelMessages(queryClient, selectedGroup.id, ch.id);
              }
            }}
            onClick={() => setSelectedChannelId(ch.id)}
            className={`flex-1 min-w-0 text-left px-4 py-2 flex items-center justify-between gap-2 transition-colors ${
              isChSelected ? 'bg-gray-100 dark:bg-white/10' : 'hover:bg-gray-50 dark:hover:bg-gray-900/80'
            }`}
          >
            <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-1.5">
              {renderChannelLeadingIcon(
                ch,
                <Hash className="w-3.5 h-3.5 shrink-0 opacity-60" />
              )}
              {ch.name}
            </span>
            {typingPreview ? (
              <span className="shrink-0 max-w-[45%] truncate text-[11px] italic text-[#5865f2]">
                {typingPreview}
              </span>
            ) : unread > 0 ? (
              <NotificationBadgeInline count={unread} />
            ) : null}
          </button>
          {editButton}
        </div>
      );
    },
    [
      channelUnreadById,
      handleVoiceChannelClick,
      isSelectedGroupAdmin,
      isVoiceChannelActive,
      openEditChannelModal,
      queryClient,
      renderChannelLeadingIcon,
      selectedChannelId,
      selectedGroup,
      t,
      typingNamesByChannelId,
      voicePresenceByChannel,
    ]
  );

  useEffect(() => {
    if (!selectedGroup?.id) return;
    debouncedReloadVoicePresence();
  }, [selectedGroup?.id, voiceChannelIdsKey, debouncedReloadVoicePresence]);

  useEffect(() => {
    if (!selectedGroup?.id || !currentUserId) return;
    const channel = supabase
      .channel(`voice-presence-${selectedGroup.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_channel_presence',
          filter: `group_id=eq.${selectedGroup.id}`,
        },
        () => {
          debouncedReloadVoicePresence();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, debouncedReloadVoicePresence, selectedGroup?.id]);

  useEffect(() => {
    if (!selectedGroup?.id || !currentUserId) {
      setTypingNamesByChannelId({});
      return;
    }

    const unsubs = textChannels.map((ch) =>
      subscribeGroupTypingBroadcast(selectedGroup.id, ch.id, (typers) => {
        const names = typers
          .filter((typer) => typer.userId !== currentUserId)
          .map((typer) => typer.displayName);
        setTypingNamesByChannelId((prev) => {
          if (names.length === 0) {
            if (!(ch.id in prev)) return prev;
            const next = { ...prev };
            delete next[ch.id];
            return next;
          }
          return { ...prev, [ch.id]: names };
        });
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
      setTypingNamesByChannelId({});
    };
  }, [currentUserId, selectedGroup?.id, textChannels]);

  const refreshGroupUnreadCounts = React.useCallback(async () => {
    if (!currentUserId) return;
    try {
      const { groupUnreadById, channelUnreadById } = await api.getGroupUnreadCounts();
      setGroupUnreadById(groupUnreadById);
      setChannelUnreadById(channelUnreadById);
    } catch (err) {
      console.error('Failed to load group unread counts:', err);
      setGroupUnreadById({});
      setChannelUnreadById({});
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!selectedGroupId) {
      setSelectedChannelId(null);
      return;
    }

    if (groupChannels.length === 0) return;

    setSelectedChannelId((prev) => {
      if (prev && groupChannels.some((channel) => channel.id === prev)) return prev;
      if (!isDesktop) return null;
      const firstText = groupChannels.find((channel) => (channel.type ?? 'text') === 'text');
      return firstText?.id ?? null;
    });
  }, [selectedGroupId, groupChannels, isDesktop]);

  const selectedTextChannelIdsKey = useMemo(() => {
    if (!selectedGroupId) return '';
    return groupChannels
      .filter((ch) => (ch.type ?? 'text') === 'text')
      .slice(0, 3)
      .map((ch) => ch.id)
      .join(',');
  }, [groupChannels, selectedGroupId]);

  React.useEffect(() => {
    if (!selectedGroupId || !selectedTextChannelIdsKey) return;
    for (const channelId of selectedTextChannelIdsKey.split(',')) {
      void prefetchGroupChannelMessages(queryClient, selectedGroupId, channelId);
    }
  }, [selectedGroupId, selectedTextChannelIdsKey, queryClient]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let mounted = true;

    const applyUser = (userId: string | null) => {
      if (mounted) setCurrentUserId(userId);
    };

    void initAuthSession().then((session) => {
      applyUser(session?.user?.id ?? getCachedUser()?.id ?? null);
    });

    const unsubscribe = subscribeAuth((_event, session) => {
      applyUser(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!showFriendsPanel) return;
    loadFriends();
  }, [showFriendsPanel, loadFriends]);

  useEffect(() => {
    if (!currentUserId) return;
    void loadFriends();
    const channel = supabase
      .channel(`friends-incoming-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friends',
          filter: `friend_id=eq.${currentUserId}`,
        },
        () => {
          void loadFriends();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, loadFriends]);

  const refreshGroupUnreadDebounced = useMemo(
    () =>
      debounce(() => {
        void refreshGroupUnreadCounts();
      }, 500),
    [refreshGroupUnreadCounts]
  );

  useEffect(() => {
    if (!currentUserId || !myGroupIdsKey) return;
    const groupIds = myGroupIdsKey.split(',').filter(Boolean);
    if (groupIds.length === 0) return;

    const channel = supabase.channel(`group-unread-${currentUserId}`);
    for (const groupId of groupIds.slice(0, 30)) {
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          refreshGroupUnreadDebounced();
        }
      );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, myGroupIdsKey, refreshGroupUnreadDebounced]);

  const incomingRequestCount = incomingRequests.length;

  useEffect(() => {
    if (!profilePreviewUserId) {
      setProfilePreviewData(null);
      return;
    }

      const loadProfile = async () => {
        try {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, display_name, username, bio, avatar_url, images')
          .eq('id', profilePreviewUserId)
          .single();

          if (profileError) throw profileError;

          if (profileData) {
            const userData: User = {
              id: profileData.id,
              name: profileData.display_name || profileData.name || 'Unknown',
              display_name: profileData.display_name || profileData.name,
              username: profileData.username,
              bio: profileData.bio || '',
              avatar_url: profileData.avatar_url,
              images: profileData.images || [],
            };
            setProfilePreviewData(userData);
          }
        } catch (error) {
          console.error('Failed to load profile:', error);
          setProfilePreviewUserId(null);
        }
      };

      loadProfile();
  }, [profilePreviewUserId]);

  const [baseContent, setBaseContent] = useState<React.ReactNode>(<div />);
  const { pushScreen, popScreen, clearStack, renderLayers } = useEdgeBackNavigation({
    baseContent,
    onStackChange: (stackDepth) => {
      if (stackDepth === 0) {
        setSelectedConversationId(null);
        setSelectedOtherUser(null);
        lastPushedChatIdRef.current = null;
        if (lastPushedGroupIdRef.current) {
          setSelectedChannelId(null);
          lastPushedGroupIdRef.current = null;
        }
      }
    }
  });
  const pushScreenRef = useRef(pushScreen);
  const popScreenRef = useRef(popScreen);
  const clearStackRef = useRef(clearStack);

  useEffect(() => {
    pushScreenRef.current = pushScreen;
    popScreenRef.current = popScreen;
  }, [pushScreen, popScreen]);

  useEffect(() => {
    clearStackRef.current = clearStack;
  }, [clearStack]);

  const selectDmHome = React.useCallback(() => {
    if (!isDesktop) {
      clearStackRef.current();
    }
    lastPushedGroupIdRef.current = null;
    setSelectedGroup(null);
    setSelectedChannelId(null);
  }, [isDesktop]);

  const selectGroupFromRail = React.useCallback(
    (g: GroupRow) => {
      lastPushedChatIdRef.current = null;
      setSelectedConversationId(null);
      setSelectedOtherUser(null);
      if (!isDesktop) {
        clearStackRef.current();
        setSelectedChannelId(null);
      }
      setSelectedGroup({ id: g.id, name: g.name, icon_url: g.icon_url ?? null });
    },
    [isDesktop]
  );

  useEffect(() => {
    if (!currentUserId) return;
    loadGroupsData();
  }, [currentUserId, loadGroupsData]);

  useEffect(() => {
    refreshGroupUnreadCounts();
  }, [refreshGroupUnreadCounts]);

  const formatLastMessageTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    const lang = i18n.language || 'en';
    const isDe = lang.startsWith('de');
    const isEs = lang.startsWith('es');
    const locale = isDe ? 'de-DE' : isEs ? 'es-ES' : 'en-US';

    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isToday) {
      return date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: !isDe && !isEs, // en: 12h, de/es: 24h
      });
    }

    return date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    });
  };

  const MessagesContent = useMemo(() => {
    if (loading && conversations.length === 0) {
      return (
        <div className="h-full flex items-center justify-center bg-white dark:bg-black md:dark:bg-[#121212]">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-transparent border-t-orange-600 border-r-red-600 border-b-pink-600 border-l-orange-600 dark:border-t-orange-400 dark:border-r-red-400 dark:border-b-pink-400 dark:border-l-orange-400 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">{t('chat.loadingConversations')}</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-full flex items-center justify-center bg-white dark:bg-black md:dark:bg-[#121212]">
          <div className="text-center p-4">
            <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button onClick={() => reload()} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors" style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}>{t('chat.retry')}</button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="h-full min-h-0 w-full flex flex-row bg-white dark:bg-black md:dark:bg-[#121212] overflow-hidden pb-16 box-border"
      >
        <div
          className="flex flex-col items-center gap-2 py-3 px-1.5 w-[4.5rem] shrink-0 overflow-visible bg-[#1e1f22] border-r border-black/30"
          aria-label={t('groups.tabGroups')}
        >
          <button
            type="button"
            onClick={() => {
              setGroupActionTab('create');
              setShowGroupActionModal(true);
            }}
            title={t('groups.railCreateTooltip')}
            className="relative w-12 h-12 shrink-0 rounded-full bg-[#313338] flex items-center justify-center text-[#23a559] border-2 border-[#313338] border-dashed border-opacity-80 hover:bg-[#23a559] hover:text-white hover:border-[#23a559] transition-colors"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <Plus className="w-7 h-7 stroke-[2.5]" />
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={selectDmHome}
              title={t('groups.railDmTooltip')}
              className={`w-12 h-12 flex items-center justify-center text-white transition-transform ${
                !selectedGroup
                  ? 'bg-[#5865f2] rounded-2xl'
                  : 'bg-[#313338] rounded-full hover:rounded-2xl hover:bg-[#5865f2]'
              }`}
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
            >
              <MessageCircle className="w-6 h-6" />
            </button>
            <NotificationBadge count={dmUnreadTotal} />
          </div>

          <div className="w-8 h-px bg-white/10 shrink-0 my-0.5" />

          {groupsLoading ? (
            <div className="w-8 h-8 border-2 border-[#5865f2] border-t-transparent rounded-full animate-spin" />
          ) : (
            myGroupRows
              .filter((r) => r.group)
              .map((row) => {
                const g = row.group as GroupRow;
                const isActive = selectedGroup?.id === g.id;
                const unread = groupUnreadById[g.id] || 0;
                return (
                  <GroupRailIcon
                    key={row.id}
                    group={g}
                    isActive={isActive}
                    unread={unread}
                    onSelect={() => selectGroupFromRail(g)}
                    onPrefetch={() => {
                      void prefetchGroupChannels(queryClient, g.id);
                    }}
                    onOpenActions={(event) => openGroupActions(event, g)}
                  />
                );
              })
          )}
        </div>

        <div className="flex flex-1 min-w-0 min-h-0">
          <div className="flex flex-col flex-1 min-w-0 min-h-0 md:max-w-[340px] md:w-[32%] md:shrink-0 border-r border-gray-200 dark:border-white/10 bg-white dark:bg-black">
            <div className="sticky top-0 z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-gray-200 dark:border-white/5 px-4 py-4 shrink-0">
              <div className="flex items-center justify-between gap-3">
                {selectedGroup ? (
                  <ServerTitleButton
                    name={selectedGroup.name}
                    onOpenActions={(event) => openGroupActions(event, selectedGroup)}
                  />
                ) : (
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
                    {t('nav.messages')}
                  </h1>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedGroup && isSelectedGroupAdmin ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowCreateChannelModal(true)}
                        title={t('groups.createChannel')}
                        className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                      >
                        <Hash className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openGroupInviteModal()}
                        title={t('groups.serverInvite')}
                        className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : selectedGroup ? (
                    <button
                      type="button"
                      onClick={() => openGroupInviteModal()}
                      title={t('groups.serverInvite')}
                      className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  ) : null}
                  {!selectedGroup ? (
                    <button
                      onClick={() => setShowFriendsPanel((prev) => !prev)}
                      className="relative px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shrink-0"
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                    >
                      {t('chat.addFriend')}
                      {!showFriendsPanel && incomingRequestCount > 0 ? (
                        <NotificationBadge
                          count={incomingRequestCount}
                          borderClassName="border-indigo-600"
                          className="-top-2 -right-2"
                        />
                      ) : null}
                    </button>
                  ) : null}
                </div>
              </div>
            {showFriendsPanel && (
              <div className="mt-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/60 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    value={friendUsernameInput}
                    onChange={(e) => setFriendUsernameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSendFriendRequest();
                      }
                    }}
                    placeholder={t('chat.friendUsernamePlaceholder')}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleSendFriendRequest}
                    disabled={sendingRequest}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-60"
                    style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                  >
                    {sendingRequest ? t('chat.sending') : t('chat.send')}
                  </button>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('chat.incomingRequests')}</p>
                  {friendsLoading ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('chat.loadingFriends')}</p>
                  ) : incomingRequests.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('chat.noOpenRequests')}</p>
                  ) : (
                    <div className="space-y-2">
                      {incomingRequests.map((request) => {
                        const requester = request.requester;
                        const displayName = requester?.display_name || requester?.name || t('chat.unknownUser');
                        const username = requester?.username ? `@${requester.username}` : '';
                        return (
                          <div key={request.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{displayName}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{username}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleRespondRequest(request.id, 'accept')}
                                className="px-2 py-1 rounded-md bg-green-600 text-white text-xs font-medium"
                                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                              >
                                {t('chat.accept')}
                              </button>
                              <button
                                onClick={() => handleRespondRequest(request.id, 'decline')}
                                className="px-2 py-1 rounded-md bg-gray-700 text-white text-xs font-medium"
                                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                              >
                                {t('chat.decline')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {!selectedGroup ? (
            conversations.length === 0 ? (
              <div className="flex items-center justify-center min-h-[400px] p-4">
                <div className="text-center p-4">
                  <p className="text-gray-500 dark:text-gray-400 text-lg">{t('chat.noConversationsYet')}</p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">{t('chat.startConversationHint')}</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-white/5">
                {conversations.map((conv) => {
                  const otherUser = conv.other_user;
                  const unreadCount = unreadByConversation[conv.id] || 0;
                  const imageUrl = otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : undefined;
                  const isSelected = conv.id === selectedConversationId;
                  const actionUser = {
                    id: otherUser.id,
                    name: otherUser.name,
                    username: otherUser.username,
                    imageUrl,
                  };
                  return (
                    <ConversationListRow
                      key={conv.id}
                      conv={conv}
                      otherUser={otherUser}
                      unreadCount={unreadCount}
                      imageUrl={imageUrl}
                      isSelected={isSelected}
                      isTyping={isConversationTyping(conv.id)}
                      formatLastMessageTime={formatLastMessageTime}
                      onOpenChat={() => {
                        setSelectedGroup(null);
                        lastPushedGroupIdRef.current = null;
                        setSelectedConversationId(conv.id);
                        setSelectedOtherUser({
                          id: otherUser.id,
                          name: otherUser.name,
                          display_name: otherUser.display_name,
                          username: otherUser.username,
                          imageUrl,
                          is_online: otherUser.is_online,
                          age: otherUser.age,
                        });
                      }}
                      onPrefetch={() => {
                        void prefetchDmMessages(queryClient, conv.id);
                      }}
                      onOpenActions={(event) => openConversationActions(event, conv.id, actionUser)}
                    />
                  );
                })}
              </div>
            )
          ) : channelsLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groupChannels.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">{t('groups.noChannels')}</div>
          ) : (
            <div className="py-2 pb-4">
              {textChannels.length > 0 ? (
                <div className="mb-2">
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('groups.textChannelsHeading')}
                  </p>
                  <div>{textChannels.map((ch) => renderChannelRow(ch))}</div>
                </div>
              ) : null}
              {voiceChannels.length > 0 ? (
                <div className="mb-2">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('groups.voiceChannelsHeading')}
                  </p>
                  <div>{voiceChannels.map((ch) => renderChannelRow(ch))}</div>
                </div>
              ) : null}
            </div>
          )}
          </div>
          {selectedGroup && activeCall?.isVoiceChannel && activeCall.groupId === selectedGroup.id ? (
            <div className="shrink-0 border-t border-[#23a559]/30 bg-[#23a559]/10 px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2 text-sm text-[#23a559]">
                <Volume2 className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {t('groups.voiceConnected', { channel: activeCall.channelName || t('groups.voiceChannelsHeading') })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void hangUp()}
                className="shrink-0 rounded-md bg-[#23a559] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1e8e4a]"
              >
                {t('groups.voiceDisconnect')}
              </button>
            </div>
          ) : null}
        </div>

        <div className="hidden md:flex flex-1 flex-col min-h-0 min-w-0">
          {selectedGroup && selectedChannelId && currentUserId ? (
            <GroupThreadScreen
              groupId={selectedGroup.id}
              groupName={selectedGroup.name}
              channelId={selectedChannelId}
              channelName={selectedChannel?.name ?? null}
              channelIconUrl={selectedChannel?.icon_url ?? null}
              currentUserId={currentUserId}
              onBack={() => {
                setSelectedGroup(null);
                lastPushedGroupIdRef.current = null;
              }}
              onLeave={loadGroupsData}
              onOpened={refreshGroupUnreadCounts}
            />
          ) : selectedGroup &&
            currentUserId &&
            callState === 'in_call' &&
            callDisplayMode === 'embedded' &&
            activeCall?.isVoiceChannel &&
            activeCall.groupId === selectedGroup.id &&
            activeCall.channelId ? (
            <GroupVoiceChannelScreen
              groupId={selectedGroup.id}
              groupName={selectedGroup.name}
              channelId={activeCall.channelId}
              channelName={activeCall.channelName ?? t('groups.voiceChannelsHeading')}
              groupIconUrl={selectedGroup.icon_url}
              currentUserId={currentUserId}
              onBack={() => {
                setSelectedGroup(null);
                lastPushedVoiceKeyRef.current = null;
              }}
            />
          ) : selectedGroup && currentUserId && channelsLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedGroup && currentUserId && !channelsLoading && groupChannels.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-6 text-gray-500 dark:text-gray-400">
              <p className="text-sm">{t('groups.noChannels')}</p>
            </div>
          ) : !selectedGroup && selectedConversationId && selectedOtherUser && currentUserId ? (
            <ChatScreen
              key={selectedConversationId}
              conversationId={selectedConversationId}
              otherUser={{ ...selectedOtherUser, age: selectedOtherUser.age }}
              currentUserId={currentUserId}
              onBack={() => handleLeaveChat(selectedConversationId!)}
              onOpenProfilePreview={setProfilePreviewUserId}
              onConversationUpdated={() => void reload()}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-6 text-gray-500 dark:text-gray-400">
              <p className="text-sm">{t('chat.selectConversation')}</p>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }, [
    conversations,
    loading,
    error,
    reload,
    unreadByConversation,
    i18n.language,
    t,
    selectedConversationId,
    selectedOtherUser,
    currentUserId,
    showFriendsPanel,
    friendUsernameInput,
    sendingRequest,
    friendsLoading,
    incomingRequests,
    handleSendFriendRequest,
    handleRespondRequest,
    selectedGroup,
    selectDmHome,
    selectGroupFromRail,
    dmUnreadTotal,
    groupUnreadById,
    myGroupRows,
    groupsLoading,
    groupChannels,
    textChannels,
    voiceChannels,
    selectedChannelId,
    selectedChannel,
    channelsLoading,
    channelUnreadById,
    isSelectedGroupAdmin,
    renderChannelRow,
    activeCall,
    callState,
    callDisplayMode,
  ]);

  useEffect(() => {
    setBaseContent(MessagesContent);
  }, [MessagesContent]);

  useEffect(() => {
    const storedConversationId = localStorage.getItem('openConversation');
    if (storedConversationId) {
      localStorage.removeItem('openConversation');
      openConversationById(storedConversationId);
    }

    const handleOpenConversation = (event: CustomEvent) => {
      const { conversationId } = event.detail || {};
      if (conversationId) {
        openConversationById(conversationId);
      }
    };

    window.addEventListener('open-conversation', handleOpenConversation as EventListener);
    return () => {
      window.removeEventListener('open-conversation', handleOpenConversation as EventListener);
    };
  }, [openConversationById]);

  useEffect(() => {
    if (!pendingConversationIdRef.current) return;
    openConversationById(pendingConversationIdRef.current);
  }, [conversations, openConversationById]);

  useEffect(() => {
    if (isDesktop) {
      if (lastPushedChatIdRef.current) {
        popScreenRef.current();
        lastPushedChatIdRef.current = null;
      }
      if (lastPushedGroupIdRef.current) {
        popScreenRef.current();
        lastPushedGroupIdRef.current = null;
      }
      return;
    }
    if (selectedGroup || !selectedConversationId || !selectedOtherUser || !currentUserId) {
      lastPushedChatIdRef.current = null;
      return;
    }
    if (lastPushedChatIdRef.current === selectedConversationId) return;
    lastPushedChatIdRef.current = selectedConversationId;
    pushScreenRef.current(
      <ChatScreen
        key={selectedConversationId}
        conversationId={selectedConversationId}
        otherUser={{ ...selectedOtherUser, age: selectedOtherUser.age }}
        currentUserId={currentUserId}
        onBack={() => {
          handleLeaveChat(selectedConversationId);
          popScreenRef.current();
        }}
        onOpenProfilePreview={setProfilePreviewUserId}
        onConversationUpdated={() => void reload()}
      />,
      `chat-${selectedConversationId}`
    );
  }, [selectedConversationId, selectedOtherUser, currentUserId, isDesktop, selectedGroup, handleLeaveChat, reload]);

  useEffect(() => {
    if (isDesktop) return;
    if (!selectedGroup || !selectedChannelId || !currentUserId) {
      if (!selectedChannelId) lastPushedGroupIdRef.current = null;
      return;
    }
    const pushKey = `group-${selectedGroup.id}-${selectedChannelId}`;
    if (lastPushedGroupIdRef.current === pushKey) return;
    lastPushedGroupIdRef.current = pushKey;
    pushScreenRef.current(
      <GroupThreadScreen
        groupId={selectedGroup.id}
        groupName={selectedGroup.name}
        currentUserId={currentUserId}
        onBack={() => {
          setSelectedChannelId(null);
          lastPushedGroupIdRef.current = null;
          popScreenRef.current();
        }}
        onLeave={loadGroupsData}
        onOpened={refreshGroupUnreadCounts}
      />,
      pushKey
    );
  }, [selectedGroup, selectedChannelId, currentUserId, isDesktop, loadGroupsData, refreshGroupUnreadCounts]);

  useEffect(() => {
    const handleNavigateToGroupVoice = (event: Event) => {
      const { groupId, channelId, channelName, groupName } = (
        event as CustomEvent<{
          groupId: string;
          channelId: string;
          channelName?: string | null;
          groupName?: string | null;
        }>
      ).detail;
      if (!groupId || !channelId) return;

      const row = myGroupRows.find((entry) => entry.group?.id === groupId);
      const resolvedGroupName = groupName || row?.group?.name || '';
      const resolvedGroupIcon = row?.group?.icon_url ?? null;
      setSelectedGroup({
        id: groupId,
        name: resolvedGroupName,
        icon_url: resolvedGroupIcon,
      });

      if (isDesktop || !currentUserId) return;

      const pushKey = `voice-${groupId}-${channelId}`;
      if (lastPushedVoiceKeyRef.current === pushKey) return;
      lastPushedVoiceKeyRef.current = pushKey;
      pushScreenRef.current(
        <GroupVoiceChannelScreen
          groupId={groupId}
          groupName={resolvedGroupName}
          channelId={channelId}
          channelName={channelName ?? t('groups.voiceChannelsHeading')}
          groupIconUrl={resolvedGroupIcon}
          currentUserId={currentUserId}
          onBack={() => {
            lastPushedVoiceKeyRef.current = null;
            popScreenRef.current();
          }}
          onMinimizeToPip={() => {
            lastPushedVoiceKeyRef.current = null;
            popScreenRef.current();
          }}
        />,
        pushKey
      );
    };

    window.addEventListener('navigate-to-group-voice', handleNavigateToGroupVoice as EventListener);
    return () => {
      window.removeEventListener('navigate-to-group-voice', handleNavigateToGroupVoice as EventListener);
    };
  }, [currentUserId, isDesktop, myGroupRows, t]);

  const groupChannelNavValue = React.useMemo(
    () => ({
      channelId: selectedChannelId,
      groupId: selectedGroup?.id ?? null,
      channelName: selectedChannel?.name ?? null,
      channelIconUrl: selectedChannel?.icon_url ?? null,
    }),
    [selectedChannel, selectedChannelId, selectedGroup?.id]
  );

  return (
    <GroupChannelNavContext.Provider value={groupChannelNavValue}>
      <>
      {renderLayers()}

      {showGroupActionModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowGroupActionModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-action-title"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="group-action-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                {groupActionTab === 'create' ? t('groups.createTitle') : t('groups.joinViaInvite')}
              </h2>
              <button
                type="button"
                onClick={() => setShowGroupActionModal(false)}
                className="px-2 py-1 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
              >
                {t('groups.modalClose')}
              </button>
            </div>

            <div className="flex gap-2 rounded-xl bg-gray-100 dark:bg-black/40 p-1">
              <button
                type="button"
                onClick={() => setGroupActionTab('create')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  groupActionTab === 'create'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-white/5'
                }`}
              >
                {t('groups.groupActionTabCreate')}
              </button>
              <button
                type="button"
                onClick={() => setGroupActionTab('join')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  groupActionTab === 'join'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-white/5'
                }`}
              >
                {t('groups.groupActionTabJoin')}
              </button>
            </div>

            {groupActionTab === 'create' ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="create-group-name" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('groups.nameLabel')}
                  </label>
                  <input
                    id="create-group-name"
                    value={createGroupName}
                    onChange={(e) => setCreateGroupName(e.target.value)}
                    placeholder={t('groups.namePlaceholder')}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('groups.groupIconLabel')}</p>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 text-lg font-bold text-gray-500 dark:text-gray-400">
                      {createGroupIconPreview ? (
                        <img src={createGroupIconPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (createGroupName.trim().charAt(0) || '?').toUpperCase()
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => groupIconInputRef.current?.click()}
                        className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
                      >
                        {t('groups.groupIconPick')}
                      </button>
                      {createGroupIconPreview ? (
                        <button
                          type="button"
                          onClick={clearCreateGroupIcon}
                          className="rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          {t('groups.groupIconRemove')}
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={groupIconInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCreateGroupIconChange}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="create-group-desc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('groups.descriptionLabel')}
                  </label>
                  <textarea
                    id="create-group-desc"
                    value={createGroupDescription}
                    onChange={(e) => setCreateGroupDescription(e.target.value)}
                    placeholder={t('groups.descriptionPlaceholder')}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-900 dark:text-white">
                  <input
                    type="checkbox"
                    checked={createGroupPrivate}
                    onChange={(e) => setCreateGroupPrivate(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  {t('groups.privateLabel')}
                </label>
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={creatingGroup}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                >
                  {creatingGroup ? t('groups.creating') : t('groups.createSubmit')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">{t('groups.inviteHint')}</p>
                <div>
                  <label htmlFor="join-group-code" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('groups.inviteCodeLabel')}
                  </label>
                  <input
                    id="join-group-code"
                    value={joinInviteInput}
                    onChange={(e) => setJoinInviteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleJoinViaInvite();
                      }
                    }}
                    placeholder={t('groups.inviteCodePlaceholder')}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={joiningViaInvite || !joinInviteInput.trim()}
                  onClick={() => void handleJoinViaInvite()}
                  className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium disabled:opacity-60"
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                >
                  {joiningViaInvite ? t('groups.joining') : t('groups.join')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateChannelModal && selectedGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateChannelModal(false)}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('groups.createChannelTitle')}</h2>
            <input
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder={t('groups.channelNamePlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            <div className="space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('groups.channelIconLabel')}</p>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                  {newChannelIconPreview ? (
                    <img src={newChannelIconPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Hash className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => channelIconInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    {t('groups.channelIconPick')}
                  </button>
                  {newChannelIconPreview ? (
                    <button
                      type="button"
                      onClick={clearNewChannelIcon}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      {t('groups.channelIconRemove')}
                    </button>
                  ) : null}
                </div>
                <input
                  ref={channelIconInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleNewChannelIconChange}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setNewChannelType('text')} className={`flex-1 rounded-lg px-3 py-2 text-sm ${newChannelType === 'text' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-white/10'}`}>{t('groups.channelTypeText')}</button>
              <button type="button" onClick={() => setNewChannelType('voice')} className={`flex-1 rounded-lg px-3 py-2 text-sm ${newChannelType === 'voice' ? 'bg-[#23a559] text-white' : 'bg-gray-100 dark:bg-white/10'}`}>{t('groups.channelTypeVoice')}</button>
            </div>
            <button type="button" disabled={creatingChannel} onClick={() => void handleCreateChannel()} className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium disabled:opacity-60">{creatingChannel ? t('groups.creating') : t('groups.createSubmit')}</button>
          </div>
        </div>
      )}

      {showEditChannelModal && selectedGroup && editingChannel ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeEditChannelModal}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('groups.editChannelTitle')}</h2>
            <input
              value={editChannelName}
              onChange={(e) => setEditChannelName(e.target.value)}
              placeholder={t('groups.channelNamePlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            <div className="space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('groups.channelIconLabel')}</p>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                  {editChannelIconPreview ? (
                    <img src={editChannelIconPreview} alt="" className="w-full h-full object-cover" />
                  ) : editingChannel.type === 'voice' ? (
                    <Volume2 className="w-5 h-5 text-gray-400" />
                  ) : (
                    <Hash className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => editChannelIconInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    {t('groups.channelIconPick')}
                  </button>
                  {editChannelIconPreview ? (
                    <button
                      type="button"
                      onClick={clearEditChannelIcon}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      {t('groups.channelIconRemove')}
                    </button>
                  ) : null}
                </div>
                <input
                  ref={editChannelIconInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEditChannelIconChange}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={updatingChannel}
              onClick={() => void handleUpdateChannel()}
              className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium disabled:opacity-60"
            >
              {updatingChannel ? t('groups.saving') : t('groups.saveChannel')}
            </button>
            {editingChannel.name === 'general' && (editingChannel.type ?? 'text') === 'text' ? null : (
              <button
                type="button"
                disabled={deletingChannel || updatingChannel}
                onClick={() => void handleDeleteChannel()}
                className="w-full rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 py-2 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {deletingChannel ? t('groups.deleting') : t('groups.deleteChannel')}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {showEditGroupModal && editingGroupId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={closeEditGroupModal}
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('groups.editServerTitle')}
              </h2>
              <button
                type="button"
                onClick={closeEditGroupModal}
                className="px-2 py-1 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
              >
                {t('groups.modalClose')}
              </button>
            </div>
            <div>
              <label htmlFor="edit-group-name" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('groups.nameLabel')}
              </label>
              <input
                id="edit-group-name"
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                placeholder={t('groups.namePlaceholder')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('groups.groupIconLabel')}</p>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 text-lg font-bold text-gray-500 dark:text-gray-400">
                  {editGroupIconPreview ? (
                    <img src={editGroupIconPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (editGroupName.trim().charAt(0) || '?').toUpperCase()
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => editGroupIconInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    {t('groups.groupIconPick')}
                  </button>
                  {editGroupIconPreview ? (
                    <button
                      type="button"
                      onClick={clearEditGroupIcon}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      {t('groups.groupIconRemove')}
                    </button>
                  ) : null}
                </div>
                <input
                  ref={editGroupIconInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEditGroupIconChange}
                />
              </div>
            </div>
            <div>
              <label htmlFor="edit-group-desc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('groups.descriptionLabel')}
              </label>
              <textarea
                id="edit-group-desc"
                value={editGroupDescription}
                onChange={(e) => setEditGroupDescription(e.target.value)}
                placeholder={t('groups.descriptionPlaceholder')}
                rows={3}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-900 dark:text-white">
              <input
                type="checkbox"
                checked={editGroupPrivate}
                onChange={(e) => setEditGroupPrivate(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              {t('groups.privateLabel')}
            </label>
            <button
              type="button"
              disabled={updatingGroup}
              onClick={() => void handleUpdateGroup()}
              className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium disabled:opacity-60"
            >
              {updatingGroup ? t('groups.saving') : t('groups.saveServer')}
            </button>
          </div>
        </div>
      ) : null}

      {showInviteModal && (inviteTargetGroupId ?? selectedGroup) ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setShowInviteModal(false); setInviteTargetGroupId(null); }}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('groups.inviteTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('groups.invitePermanentHint')}</p>
            {inviteLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : groupInvite ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-300">{t('groups.inviteCodeLabel')}</p>
                <code className="block rounded-lg bg-black/10 dark:bg-black/40 px-3 py-2 text-sm font-mono">{groupInvite.code}</code>
                {groupInvite.url ? <p className="text-xs break-all text-gray-500">{groupInvite.url}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('groups.inviteFailedBody')}</p>
            )}
            {inviteGroupAdmin ? (
              <button
                type="button"
                disabled={refreshingInvite || inviteLoading}
                onClick={() => void handleRefreshInvite()}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 py-2 text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshingInvite ? 'animate-spin' : ''}`} />
                {refreshingInvite ? t('groups.refreshingInvite') : t('groups.refreshInvite')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {profilePreviewUserId && profilePreviewData && (
        <SharedProfileView
          profile={profilePreviewData}
          conversationId={
            conversations.find((conv) => conv.other_user.id === profilePreviewUserId)?.id
          }
          onOpenConversationActions={(event, conversationId) => {
            openConversationActions(event, conversationId, {
              id: profilePreviewData.id,
              name: profilePreviewData.display_name || profilePreviewData.name,
              username: profilePreviewData.username,
              imageUrl: profilePreviewData.avatar_url || profilePreviewData.images?.[0],
            });
          }}
          onClose={() => {
            setProfilePreviewUserId(null);
            setProfilePreviewData(null);
          }}
        />
      )}

      {conversationActionsMenu ? (
        <ConversationActionsMenu
          target={conversationActionsMenu}
          onClose={() => setConversationActionsMenu(null)}
          onViewProfile={() => {
            setProfilePreviewUserId(conversationActionsMenu.otherUser.id);
          }}
          onRemoveFriend={() => handleRemoveFriend(conversationActionsMenu)}
          onBlockUser={() => handleBlockFriendFromMenu(conversationActionsMenu)}
        />
      ) : null}

      {groupActionsMenu ? (
        <GroupActionsMenu
          target={groupActionsMenu}
          onClose={() => setGroupActionsMenu(null)}
          onEdit={
            groupActionsMenu.isAdmin
              ? () => openEditGroupModal(groupActionsMenu)
              : undefined
          }
          onInvite={() => openGroupInviteModal(groupActionsMenu.groupId)}
          onLeave={() => handleLeaveGroupFromMenu(groupActionsMenu)}
          onDelete={
            groupActionsMenu.isAdmin
              ? () => handleDeleteGroupFromMenu(groupActionsMenu)
              : undefined
          }
        />
      ) : null}
      </>
    </GroupChannelNavContext.Provider>
  );
}

interface GroupRailIconProps {
  group: GroupRow;
  isActive: boolean;
  unread: number;
  onSelect: () => void;
  onPrefetch: () => void;
  onOpenActions: (event: React.MouseEvent | React.PointerEvent) => void;
}

function GroupRailIcon({
  group,
  isActive,
  unread,
  onSelect,
  onPrefetch,
  onOpenActions,
}: GroupRailIconProps) {
  const longPress = useLongPress(onOpenActions);
  const { onPointerDown: onLongPressPointerDown, ...longPressHandlers } = longPress;
  const hue = groupAccentHue(group.id);
  const initial = (group.name?.trim().charAt(0) || '?').toUpperCase();
  const iconSrc = group.icon_url ? getOptimizedImageUrl(group.icon_url, 96) : null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onPointerDown={(event) => {
          onPrefetch();
          onLongPressPointerDown(event);
        }}
        onClick={onSelect}
        onContextMenu={onOpenActions}
        title={group.name}
        className={`w-12 h-12 overflow-hidden flex items-center justify-center text-sm font-bold text-white transition-transform ${
          isActive ? 'rounded-2xl ring-2 ring-white' : 'rounded-full hover:rounded-2xl'
        }`}
        style={{
          background: iconSrc
            ? undefined
            : `linear-gradient(145deg, hsl(${hue}, 42%, 42%), hsl(${hue}, 45%, 32%))`,
          touchAction: 'manipulation',
          cursor: 'pointer',
        }}
        {...longPressHandlers}
      >
        {iconSrc ? (
          <img src={iconSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>
      <NotificationBadge count={unread} />
    </div>
  );
}

interface ServerTitleButtonProps {
  name: string;
  onOpenActions: (event: React.MouseEvent | React.PointerEvent) => void;
}

function ServerTitleButton({ name, onOpenActions }: ServerTitleButtonProps) {
  const longPress = useLongPress(onOpenActions);

  return (
    <div
      className="min-w-0 flex-1"
      onContextMenu={onOpenActions}
      {...longPress}
    >
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate select-none">
        {name}
      </h1>
    </div>
  );
}

interface ConversationListRowProps {
  conv: Conversation;
  otherUser: Conversation['other_user'];
  unreadCount: number;
  imageUrl?: string;
  isSelected: boolean;
  isTyping: boolean;
  formatLastMessageTime: (iso: string) => string;
  onOpenChat: () => void;
  onPrefetch: () => void;
  onOpenActions: (event: React.MouseEvent | React.PointerEvent) => void;
}

function ConversationListRow({
  conv,
  otherUser,
  unreadCount,
  imageUrl,
  isSelected,
  isTyping,
  formatLastMessageTime,
  onOpenChat,
  onPrefetch,
  onOpenActions,
}: ConversationListRowProps) {
  const { t } = useTranslation();
  const longPress = useLongPress(onOpenActions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenChat}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenChat();
        }
      }}
      onPointerDown={(event) => {
        onPrefetch();
        longPress.onPointerDown(event);
      }}
      onPointerUp={longPress.onPointerUp}
      onPointerLeave={longPress.onPointerLeave}
      onPointerCancel={longPress.onPointerCancel}
      onClickCapture={longPress.onClickCapture}
      onContextMenu={onOpenActions}
      className={`w-full cursor-pointer transition-colors ${isSelected ? 'bg-gray-100 dark:bg-gray-900/90' : 'hover:bg-gray-50 dark:hover:bg-gray-900'}`}
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
    >
      <div className="flex w-full items-center gap-3 p-4">
        <div className="relative shrink-0">
          {imageUrl ? (
            <img src={imageUrl} alt={otherUser.name} className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 via-pink-400 to-red-400 flex items-center justify-center text-white text-lg font-bold">
              {otherUser.name?.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          {otherUser.is_online ? (
            <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-black" />
          ) : null}
          <NotificationBadge count={unreadCount} borderClassName="border-white dark:border-black" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="truncate font-semibold text-gray-900 dark:text-white">
              {otherUser.name}
              {otherUser.username ? (
                <span className="font-normal text-gray-500 dark:text-gray-400"> @{otherUser.username}</span>
              ) : null}
            </h3>
            {conv.last_message_at ? (
              <span className="ml-2 shrink-0 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                {formatLastMessageTime(conv.last_message_at)}
              </span>
            ) : null}
          </div>
          <p
            className={`truncate text-sm ${
              isTyping
                ? 'italic text-[#5865f2]'
                : unreadCount > 0
                  ? 'font-medium text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {isTyping ? t('chat.typingPreview') : conv.last_message || t('chat.noMessagesYet')}
          </p>
        </div>
      </div>
    </div>
  );
}
