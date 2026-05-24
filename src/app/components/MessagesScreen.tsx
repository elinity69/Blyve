import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useEdgeBackNavigation } from '../hooks/useEdgeBackNavigation';
import { useConversations } from '../hooks/useConversations';
import { ChatScreen } from './ChatScreen';
import { GroupThreadScreen } from './GroupThreadScreen';
import { SharedProfileView } from './SharedProfileView';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { getOptimizedImageUrl } from '../lib/images';
import { User } from '../types';
import { useUnread } from '../context/UnreadContext';
import { useTranslation } from 'react-i18next';
import { toast } from '../lib/toast';
import { Plus, MessageCircle, Volume2, Hash, Link2, UserPlus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { GroupChannelNavContext } from '../context/GroupChannelNavContext';
import { useCall } from '../context/CallContext';
import {
  formatGroupTypingLabel,
  subscribeGroupTypingBroadcast,
} from '../lib/groupTypingBroadcast';

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
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [groupUnreadById, setGroupUnreadById] = useState<Record<string, number>>({});
  const [channelUnreadById, setChannelUnreadById] = useState<Record<string, number>>({});
  const [myGroupRows, setMyGroupRows] = useState<MyGroupMembership[]>([]);
  const [groupChannels, setGroupChannels] = useState<GroupChannelRow[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
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
  const [showJoinInviteModal, setShowJoinInviteModal] = useState(false);
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

  const { conversations, loading, error, reload } = useConversations();
  const { enterCallPip, isCallForConversation, joinVoiceChannel, isVoiceChannelActive, activeCall, hangUp, state: callState } = useCall();
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

  const isConversationTyping = React.useCallback(
    (conversationId: string) => Boolean(typingByConversation[conversationId]),
    [typingByConversation]
  );
  const handleLeaveChat = React.useCallback(
    (conversationId: string) => {
      if (callState === 'in_call' && isCallForConversation(conversationId)) {
        enterCallPip();
      }
      setSelectedConversationId(null);
      setSelectedOtherUser(null);
      lastPushedChatIdRef.current = null;
    },
    [callState, enterCallPip, isCallForConversation]
  );
  const lastPushedChatIdRef = useRef<string | null>(null);
  const lastPushedGroupIdRef = useRef<string | null>(null);
  const pendingConversationIdRef = useRef<string | null>(null);

  const openConversationById = React.useCallback((conversationId: string) => {
    setSelectedGroup(null);
    setSelectedChannelId(null);
    setGroupChannels([]);
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
      setShowCreateGroupModal(false);
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

  const textChannels = useMemo(
    () => groupChannels.filter((ch) => (ch.type ?? 'text') === 'text'),
    [groupChannels]
  );
  const voiceChannels = useMemo(
    () => groupChannels.filter((ch) => ch.type === 'voice'),
    [groupChannels]
  );

  const selectedChannel = useMemo(
    () => groupChannels.find((c) => c.id === selectedChannelId) ?? null,
    [groupChannels, selectedChannelId]
  );

  const reloadVoicePresence = React.useCallback(async () => {
    if (!selectedGroup?.id || voiceChannels.length === 0) {
      setVoicePresenceByChannel({});
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
  }, [selectedGroup?.id, voiceChannels]);

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
        setGroupChannels((prev) => [...prev, channel].sort((a, b) => a.position - b.position));
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
  }, [newChannelIconFile, newChannelName, newChannelType, reloadVoicePresence, selectedGroup?.id, t]);

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
        setGroupChannels((prev) =>
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
      setGroupChannels((prev) => prev.filter((entry) => entry.id !== editingChannel.id));
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
    reloadVoicePresence,
    selectedChannelId,
    selectedGroup?.id,
    t,
  ]);

  const loadGroupInvite = React.useCallback(async () => {
    if (!selectedGroup?.id) return;
    try {
      setInviteLoading(true);
      const data = await api.getGroupInvite(selectedGroup.id);
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
  }, [selectedGroup?.id, t]);

  const handleRefreshInvite = React.useCallback(async () => {
    if (!selectedGroup?.id || !isSelectedGroupAdmin) return;
    if (!window.confirm(t('groups.refreshInviteConfirm'))) return;
    try {
      setRefreshingInvite(true);
      const data = await api.refreshGroupInvite(selectedGroup.id);
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
  }, [isSelectedGroupAdmin, selectedGroup?.id, t]);

  useEffect(() => {
    if (!showInviteModal || !selectedGroup?.id) return;
    void loadGroupInvite();
  }, [loadGroupInvite, selectedGroup?.id, showInviteModal]);

  const handleJoinViaInvite = React.useCallback(async () => {
    const code = joinInviteInput.trim();
    if (!code) return;
    try {
      setJoiningViaInvite(true);
      const data = await api.joinGroupViaInvite(code);
      toast.success(t('groups.joined'));
      setJoinInviteInput('');
      setShowJoinInviteModal(false);
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
        enterCallPip();
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
      } catch (err: any) {
        toast.error(t('groups.voiceJoinFailedTitle'), err?.message || t('groups.voiceJoinFailedBody'));
      }
    },
    [enterCallPip, isVoiceChannelActive, joinVoiceChannel, reloadVoicePresence, selectedGroup, t]
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
      const badge = unread > 99 ? '99+' : unread > 0 ? String(unread) : null;
      const typingNames = typingNamesByChannelId[ch.id] || [];
      const typingPreview = typingNames.length > 0 ? formatGroupTypingLabel(typingNames, t) : null;
      const isChSelected = ch.id === selectedChannelId;
      return (
        <div key={ch.id} className="group flex items-center">
          <button
            type="button"
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
            ) : badge ? (
              <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {badge}
              </span>
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
      renderChannelLeadingIcon,
      selectedChannelId,
      selectedGroup,
      t,
      typingNamesByChannelId,
      voicePresenceByChannel,
    ]
  );

  useEffect(() => {
    void reloadVoicePresence();
  }, [reloadVoicePresence]);

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
          void reloadVoicePresence();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, reloadVoicePresence, selectedGroup?.id]);

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
    const ids = myGroupRows.map((r) => r.group?.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      setGroupUnreadById({});
      setChannelUnreadById({});
      return;
    }
    const nextGroup: Record<string, number> = {};
    const nextChannel: Record<string, number> = {};

    await Promise.all(
      ids.map(async (gid) => {
        const { data: channels, error: chErr } = await supabase
          .from('group_channels')
          .select('id, type')
          .eq('group_id', gid);

        if (chErr || !channels?.length) {
          nextGroup[gid] = 0;
          return;
        }

        let sum = 0;
        await Promise.all(
          (channels || [])
            .filter((ch) => (ch as { type?: string }).type !== 'voice')
            .map(async ({ id: cid }) => {
            const lastRead = localStorage.getItem(`blyve_group_channel_last_read_${cid}`);
            let q = supabase
              .from('group_messages')
              .select('*', { count: 'exact', head: true })
              .eq('channel_id', cid)
              .neq('sender_id', currentUserId);
            if (lastRead) {
              q = q.gt('created_at', lastRead);
            }
            const { count, error } = await q;
            const n = error ? 0 : count || 0;
            nextChannel[cid] = n;
            sum += n;
          })
        );
        nextGroup[gid] = sum;
      })
    );

    setGroupUnreadById(nextGroup);
    setChannelUnreadById(nextChannel);
  }, [currentUserId, myGroupRows]);

  useEffect(() => {
    if (!selectedGroup?.id) {
      setGroupChannels([]);
      setSelectedChannelId(null);
      return;
    }

    setSelectedChannelId(null);
    setGroupChannels([]);

    let cancelled = false;
    (async () => {
      try {
        setChannelsLoading(true);
        const channelsData = await api.getGroupChannels(selectedGroup.id);
        if (cancelled) return;
        const list = (channelsData?.channels || []) as GroupChannelRow[];
        setGroupChannels(list);
        setSelectedChannelId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          const firstText = list.find((c) => (c.type ?? 'text') === 'text');
          return firstText?.id ?? null;
        });
      } catch (err: any) {
        if (!cancelled) {
          toast.error(t('groups.loadChannelsFailedTitle'), err?.message || t('groups.loadChannelsFailedBody'));
          setGroupChannels([]);
          setSelectedChannelId(null);
        }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.id, t]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
        }
      } catch (error) {
        console.error('Failed to get current user:', error);
      }
    };
    getCurrentUser();
  }, []);

  useEffect(() => {
    if (!showFriendsPanel) return;
    loadFriends();
  }, [showFriendsPanel, loadFriends]);

  useEffect(() => {
    if (!profilePreviewUserId) {
      setProfilePreviewData(null);
      return;
    }

      const loadProfile = async () => {
        try {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
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
        setSelectedGroup(null);
        lastPushedGroupIdRef.current = null;
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
    setGroupChannels([]);
  }, [isDesktop]);

  const selectGroupFromRail = React.useCallback(
    (g: GroupRow) => {
      lastPushedChatIdRef.current = null;
      setSelectedConversationId(null);
      setSelectedOtherUser(null);
      if (!isDesktop) {
        // clearStack() triggers onStackChange(0) which sets selectedGroup to null — run after that.
        clearStackRef.current();
        window.setTimeout(() => {
          setSelectedGroup({ id: g.id, name: g.name, icon_url: g.icon_url ?? null });
        }, 0);
      } else {
        setSelectedGroup({ id: g.id, name: g.name, icon_url: g.icon_url ?? null });
      }
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
          className="flex flex-col items-center gap-2 py-3 px-1.5 w-[4.5rem] shrink-0 bg-[#1e1f22] border-r border-black/30"
          aria-label={t('groups.tabGroups')}
        >
          <button
            type="button"
            onClick={() => setShowCreateGroupModal(true)}
            title={t('groups.railCreateTooltip')}
            className="relative w-12 h-12 shrink-0 rounded-full bg-[#313338] flex items-center justify-center text-[#23a559] border-2 border-[#313338] border-dashed border-opacity-80 hover:bg-[#23a559] hover:text-white hover:border-[#23a559] transition-colors"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <Plus className="w-7 h-7 stroke-[2.5]" />
          </button>

          <button
            type="button"
            onClick={selectDmHome}
            title={t('groups.railDmTooltip')}
            className={`relative w-12 h-12 shrink-0 flex items-center justify-center text-white transition-transform ${
              !selectedGroup
                ? 'bg-[#5865f2] rounded-2xl'
                : 'bg-[#313338] rounded-full hover:rounded-2xl hover:bg-[#5865f2]'
            }`}
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <MessageCircle className="w-6 h-6" />
            {dmUnreadTotal > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[1.125rem] h-[1.125rem] px-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#1e1f22]">
                {dmUnreadTotal > 99 ? '99+' : dmUnreadTotal}
              </span>
            ) : null}
          </button>

          <div className="w-8 h-px bg-white/10 shrink-0 my-0.5" />

          {groupsLoading ? (
            <div className="w-8 h-8 border-2 border-[#5865f2] border-t-transparent rounded-full animate-spin" />
          ) : (
            myGroupRows
              .filter((r) => r.group)
              .map((row) => {
                const g = row.group as GroupRow;
                const hue = groupAccentHue(g.id);
                const isActive = selectedGroup?.id === g.id;
                const unread = groupUnreadById[g.id] || 0;
                const badge = unread > 99 ? '99+' : unread > 0 ? String(unread) : null;
                const initial = (g.name?.trim().charAt(0) || '?').toUpperCase();
                const iconSrc = g.icon_url ? getOptimizedImageUrl(g.icon_url, 96) : null;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectGroupFromRail(g)}
                    title={g.name}
                    className={`relative w-12 h-12 shrink-0 overflow-hidden flex items-center justify-center text-sm font-bold text-white transition-transform ${
                      isActive ? 'rounded-2xl ring-2 ring-white' : 'rounded-full hover:rounded-2xl'
                    }`}
                    style={{
                      background: iconSrc
                        ? undefined
                        : `linear-gradient(145deg, hsl(${hue}, 42%, 42%), hsl(${hue}, 45%, 32%))`,
                      touchAction: 'manipulation',
                      cursor: 'pointer',
                    }}
                  >
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                    {badge ? (
                      <span className="absolute -top-1 -right-1 min-w-[1.125rem] h-[1.125rem] px-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#1e1f22]">
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })
          )}
        </div>

        <div className="flex flex-1 min-w-0 min-h-0">
          <div className="flex flex-col flex-1 min-w-0 min-h-0 md:max-w-[340px] md:w-[32%] md:shrink-0 border-r border-gray-200 dark:border-white/10 bg-white dark:bg-black">
            <div className="sticky top-0 z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-gray-200 dark:border-white/5 px-4 py-4 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {selectedGroup ? selectedGroup.name : t('nav.messages')}
                </h1>
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
                        onClick={() => setShowInviteModal(true)}
                        title={t('groups.serverInvite')}
                        className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : selectedGroup ? (
                    <button
                      type="button"
                      onClick={() => setShowInviteModal(true)}
                      title={t('groups.serverInvite')}
                      className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowJoinInviteModal(true)}
                    title={t('groups.joinViaInvite')}
                    className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                  {!selectedGroup ? (
                    <button
                      onClick={() => setShowFriendsPanel((prev) => !prev)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shrink-0"
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                    >
                      {t('chat.addFriend')}
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
                  const unreadBadgeText = unreadCount > 99 ? '99+' : unreadCount > 0 ? unreadCount.toString() : null;
                  const imageUrl = otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : undefined;
                  const isSelected = conv.id === selectedConversationId;
                  return (
                    <button key={conv.id} onClick={() => { setSelectedGroup(null); lastPushedGroupIdRef.current = null; setSelectedConversationId(conv.id); setSelectedOtherUser({ id: otherUser.id, name: otherUser.name, display_name: otherUser.display_name, username: otherUser.username, imageUrl: imageUrl, is_online: otherUser.is_online, age: otherUser.age }); }} className={`w-full p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left ${isSelected ? 'bg-gray-100 dark:bg-gray-900/90' : ''}`} style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}>
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {imageUrl ? <img src={imageUrl} alt={otherUser.name} className="w-14 h-14 rounded-full object-cover" /> : <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 via-pink-400 to-red-400 flex items-center justify-center text-white text-lg font-bold">{otherUser.name?.charAt(0).toUpperCase() || '?'}</div>}
                          {otherUser.is_online && <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-black"></div>}
                          {unreadBadgeText && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                              {unreadBadgeText}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                              {otherUser.name}
                              {otherUser.username ? (
                                <span className="text-gray-500 dark:text-gray-400 font-normal"> @{otherUser.username}</span>
                              ) : null}
                            </h3>
                            {conv.last_message_at && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-2">
                                {formatLastMessageTime(conv.last_message_at)}
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-sm truncate ${
                              isConversationTyping(conv.id)
                                ? 'text-[#5865f2] italic'
                                : unreadCount > 0
                                  ? 'text-gray-900 dark:text-white font-medium'
                                  : 'text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {isConversationTyping(conv.id)
                              ? t('chat.typingPreview')
                              : conv.last_message || t('chat.noMessagesYet')}
                          </p>
                        </div>
                      </div>
                    </button>
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
              conversationId={selectedConversationId}
              otherUser={{ ...selectedOtherUser, age: selectedOtherUser.age }}
              currentUserId={currentUserId}
              onBack={() => handleLeaveChat(selectedConversationId!)}
              onOpenProfilePreview={setProfilePreviewUserId}
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
        conversationId={selectedConversationId}
        otherUser={{ ...selectedOtherUser, age: selectedOtherUser.age }}
        currentUserId={currentUserId}
        onBack={() => {
          handleLeaveChat(selectedConversationId);
          popScreenRef.current();
        }}
        onOpenProfilePreview={setProfilePreviewUserId}
      />,
      `chat-${selectedConversationId}`
    );
  }, [selectedConversationId, selectedOtherUser, currentUserId, isDesktop, selectedGroup]);

  useEffect(() => {
    if (isDesktop) return;
    if (!selectedGroup || !selectedChannelId || !currentUserId) {
      lastPushedGroupIdRef.current = null;
      return;
    }
    if (lastPushedGroupIdRef.current === selectedGroup.id) return;
    lastPushedGroupIdRef.current = selectedGroup.id;
    pushScreenRef.current(
      <GroupThreadScreen
        groupId={selectedGroup.id}
        groupName={selectedGroup.name}
        currentUserId={currentUserId}
        onBack={() => {
          setSelectedGroup(null);
          lastPushedGroupIdRef.current = null;
          popScreenRef.current();
        }}
        onLeave={loadGroupsData}
        onOpened={refreshGroupUnreadCounts}
      />,
      `group-${selectedGroup.id}`
    );
  }, [selectedGroup, selectedChannelId, currentUserId, isDesktop, loadGroupsData, refreshGroupUnreadCounts]);

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

      {showCreateGroupModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCreateGroupModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="create-group-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('groups.createTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateGroupModal(false)}
                className="px-2 py-1 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
              >
                {t('groups.modalClose')}
              </button>
            </div>

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

      {showInviteModal && selectedGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowInviteModal(false)}>
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
            {isSelectedGroupAdmin ? (
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
      )}

      {showJoinInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowJoinInviteModal(false)}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1f22] shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('groups.joinViaInvite')}</h2>
            <input
              value={joinInviteInput}
              onChange={(e) => setJoinInviteInput(e.target.value)}
              placeholder={t('groups.inviteCodePlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-black px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            <button type="button" disabled={joiningViaInvite} onClick={() => void handleJoinViaInvite()} className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium disabled:opacity-60">{joiningViaInvite ? t('groups.creating') : t('groups.join')}</button>
          </div>
        </div>
      )}

      {profilePreviewUserId && profilePreviewData && (
        <SharedProfileView
          profile={profilePreviewData}
          onClose={() => {
            setProfilePreviewUserId(null);
            setProfilePreviewData(null);
          }}
        />
      )}
      </>
    </GroupChannelNavContext.Provider>
  );
}
