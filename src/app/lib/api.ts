// Refactored ApiClient to use Supabase SDK directly instead of Edge Functions
import type { User } from '@supabase/supabase-js';
import { getCachedAccessToken, getOrRefreshSession, initAuthSession, resolveAuthUser } from './authSession';
import { supabase } from './supabase';
import { isJitsiCallProvider } from './callProvider';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export class ApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string | null) {
    if (this.accessToken === token) {
      return;
    }
    this.accessToken = token;
    if (token) {
      localStorage.setItem('accessToken', token);
    } else {
      localStorage.removeItem('accessToken');
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const cachedToken = getCachedAccessToken();
    if (cachedToken) {
      this.setAccessToken(cachedToken);
      return cachedToken;
    }

    const storedToken = localStorage.getItem('accessToken');
    if (storedToken) {
      this.setAccessToken(storedToken);
      return storedToken;
    }

    await initAuthSession();
    const hydratedToken = getCachedAccessToken();
    if (hydratedToken) {
      this.setAccessToken(hydratedToken);
      return hydratedToken;
    }

    return null;
  }

  private async requireUser(): Promise<User> {
    const user = await resolveAuthUser();
    if (!user) {
      throw new Error('No authenticated user');
    }
    return user;
  }

  /**
   * Edge invoke URL = `${SUPABASE_URL}/functions/v1/blyve` + path.
   * Path must be `/friends`, not `/blyve/friends` (would produce .../blyve/blyve/... → 404).
   * Strips a mistaken `/blyve` prefix so stale bundles or bad callers still work.
   */
  private normalizeEdgeFunctionPath(path: string): string {
    let p = path.startsWith('/') ? path : `/${path}`;
    if (p === '/blyve') return '/';
    if (p.startsWith('/blyve/')) {
      p = p.slice('/blyve'.length) || '/';
    }
    return p;
  }

  private async edgeRequest(path: string, init: RequestInit = {}) {
    const token = await this.getFreshAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    if (!SUPABASE_URL) {
      throw new Error('Missing VITE_SUPABASE_URL');
    }

    const safePath = this.normalizeEdgeFunctionPath(path);
    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/blyve${safePath}`;
    const makeHeaders = (tok: string): HeadersInit => ({
      Authorization: `Bearer ${tok}`,
      apikey: SUPABASE_ANON_KEY,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    });

    let response = await fetch(url, { ...init, headers: makeHeaders(token) });

    // On 401, force a session refresh and retry once — covers expired JWT tokens.
    if (response.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      const newToken = refreshed?.session?.access_token ?? null;
      if (newToken && newToken !== token) {
        this.setAccessToken(newToken);
        response = await fetch(url, { ...init, headers: makeHeaders(newToken) });
      }
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload?.error || `Request failed (${response.status})`) as Error & {
        statusCode?: number;
        responsePayload?: Record<string, unknown>;
      };
      err.statusCode = response.status;
      err.responsePayload = payload ?? {};
      throw err;
    }
    return payload;
  }

  /** Always resolves the freshest available token — forces a Supabase token refresh if the
   *  cached session is expired or close to expiry. */
  private async getFreshAccessToken(): Promise<string | null> {
    // getOrRefreshSession proactively refreshes if the token is expired (unlike getSession which just reads cache).
    const session = await getOrRefreshSession();
    const freshToken = session?.access_token ?? null;
    if (freshToken) {
      this.setAccessToken(freshToken);
      return freshToken;
    }
    // Fall back to whatever we have cached.
    return this.getAccessToken();
  }

  // Auth - Use Supabase SDK directly
  async signup(data: { email: string; password: string; name: string }) {
    try {
      // Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
      });

      if (authError) {
        throw authError;
      }

      if (!authData.user) {
        throw new Error('User creation failed');
      }

      // Create profile in database
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: data.email,
          name: data.name,
          display_name: data.name,
          onboarding_complete: false,
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Don't throw - user is created, profile can be created later
      }

      // Set token from session
      if (authData.session?.access_token) {
        this.setAccessToken(authData.session.access_token);
      }

      return {
        userId: authData.user.id,
        accessToken: authData.session?.access_token || null,
      };
    } catch (error: any) {
      console.error('Signup error:', error);
      throw error;
    }
  }

  async signin(email: string, password: string) {
    console.log('API - Signing in user:', email);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

      if (authError) {
        throw authError;
      }

      if (!authData.user || !authData.session) {
        throw new Error('Sign in failed: No user or session returned');
      }

      if (authData.session.access_token) {
        this.setAccessToken(authData.session.access_token);
      } else {
        console.error('API - No access token received from Supabase!');
      }

      return {
        userId: authData.user.id,
        accessToken: authData.session.access_token,
      };
    } catch (error: any) {
      console.error('Signin error:', error);
      throw error;
    }
  }

  async signout() {
    await supabase.auth.signOut();
    this.setAccessToken(null);
  }

  // Profile - Use Supabase SDK directly
  async getProfile() {
    try {
      const user = await this.requireUser();
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, name, email, avatar_url, display_name, username, bio, images, ghost_mode, onboarding_complete')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return profile;
    } catch (error) {
      console.error('API - Failed to get profile from Supabase:', error);
      throw error;
    }
  }

  async updateProfile(updates: any) {
    try {
      const user = await this.requireUser();
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      if (error) {
        throw error;
      }
      return data;
    } catch (error) {
      console.error('API - Failed to update profile:', error);
      throw error;
    }
  }

  async uploadProfilePicture(file: File) {
    try {
      const user = await this.requireUser();
    
    console.log('Upload starting...', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
        userId: user.id
      });

      // Upload to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with new avatar URL
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id)
        .select()
        .single();

      if (profileError) {
        throw profileError;
      }

      console.log('Upload successful:', { publicUrl, profileData });
      return { url: publicUrl, profile: profileData };
    } catch (error) {
      console.error('Upload exception:', error);
      throw error;
    }
  }

  async deleteAccount() {
    try {
      const user = await this.requireUser();
      // Delete profile first
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', user.id);
      
      if (profileError) {
        console.error('Error deleting profile:', profileError);
      }

      // Then delete auth user
      const { error: authError } = await supabase.auth.admin.deleteUser(user.id);
      if (authError) {
        // Admin API might not be available, try regular signout
        await this.signout();
      }
      
      return { success: true };
    } catch (error) {
      console.error('Delete account error:', error);
      throw error;
    }
  }

  // Update online status - Use Supabase directly
  async updateOnlineStatus() {
    try {
      const user = await this.requireUser();

      const now = new Date().toISOString();
      let { error } = await supabase
        .from('profiles')
        .update({ last_seen: now, updated_at: now })
        .eq('id', user.id);

      // Remote DB may not have last_seen yet (migration / PostgREST cache); still bump activity.
      if (
        error &&
        (error as { code?: string; message?: string }).code === 'PGRST204' &&
        String((error as { message?: string }).message || '').includes('last_seen')
      ) {
        ({ error } = await supabase
          .from('profiles')
          .update({ updated_at: now })
          .eq('id', user.id));
      }

      if (error) {
        throw error;
      }

      return { success: true };
    } catch (error) {
      console.error('API - Failed to update online status:', error);
      throw error;
    }
  }

  // Chat: Get conversations - Use Supabase directly
  async getConversations() {
    try {
      const user = await this.requireUser();

      const { data: conversations, error } = await supabase
        .from('conversations')
        .select(`
          *,
          user1:profiles!conversations_user1_id_fkey(id, name, avatar_url, images),
          user2:profiles!conversations_user2_id_fkey(id, name, avatar_url, images)
        `)
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      return { conversations: conversations || [] };
    } catch (error) {
      console.error('API - Failed to get conversations:', error);
      throw error;
    }
  }

  // Chat: Get messages for a conversation - Use Supabase directly
  async getMessages(otherUserId: string) {
    try {
      const user = await this.requireUser();

      // Find conversation
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(user1_id.eq.${user.id},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${user.id})`)
        .single();

      if (!conversation) {
        return { messages: [] };
      }

      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, created_at, is_read, read_at, reply_to_message_id')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return { messages: messages || [] };
    } catch (error) {
      console.error('API - Failed to get messages:', error);
      throw error;
    }
  }

  // User Actions - RPC Functions (already using Supabase SDK)
  async blockUser(targetId: string) {
    const { data, error } = await supabase.rpc('block_user_safe', {
      target_id: targetId,
    });
    if (error) throw error;
    return data;
  }

  async sendMessageSafe(
    conversationId: string,
    content: string,
    replyToMessageId?: string | null,
    attachmentIds?: string[],
  ) {
    const { data, error } = await supabase.rpc('send_message_safe', {
      p_conversation_id: conversationId,
      p_content: content,
      p_reply_to_message_id: replyToMessageId ?? null,
      p_attachment_ids: attachmentIds?.length ? attachmentIds : null,
    });
    if (error) throw error;
    return data;
  }

  async deleteMessageSafe(messageId: string) {
    const { data, error } = await supabase.rpc('delete_message_safe', {
      p_message_id: messageId,
    });
    if (error) throw error;
    return data as {
      success?: boolean;
      message?: string;
      conversation_id?: string;
      last_message?: string | null;
      last_message_at?: string | null;
    };
  }

  async editMessageSafe(messageId: string, content: string) {
    const { data, error } = await supabase.rpc('update_message_safe', {
      p_message_id: messageId,
      p_content: content,
    });
    if (error) throw error;
    return data as { success?: boolean; message?: string };
  }

  /** Presigned R2 upload — credentials stay on the edge function only. */
  async requestUploadPresign(body: {
    mimeType: string;
    sizeBytes: number;
    filename?: string;
    conversation_id?: string;
    group_id?: string;
    channel_id?: string;
  }) {
    return this.edgeRequest('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({
        mime_type: body.mimeType,
        size_bytes: body.sizeBytes,
        filename: body.filename,
        conversation_id: body.conversation_id,
        group_id: body.group_id,
        channel_id: body.channel_id,
      }),
    }) as Promise<{
      attachmentId: string;
      uploadUrl: string;
      method: 'PUT';
      headers: Record<string, string>;
      storageKey: string;
      expiresIn: number;
      kind: string;
    }>;
  }

  async putFileToPresignedUrl(
    uploadUrl: string,
    file: File | Blob,
    headers: Record<string, string>,
  ) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers,
      body: file,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Upload failed (${response.status})`);
    }
  }

  async confirmUpload(attachmentId: string) {
    return this.edgeRequest('/uploads/confirm', {
      method: 'POST',
      body: JSON.stringify({ attachment_id: attachmentId }),
    }) as Promise<{
      attachmentId: string;
      status: string;
      publicUrl: string | null;
      kind: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
    }>;
  }

  async sendFriendRequest(friendUsername: string) {
    const username = friendUsername.trim().replace(/^@/, '');
    return this.edgeRequest('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friend_username: username }),
    });
  }

  async getFriends() {
    return this.edgeRequest('/friends', { method: 'GET' });
  }

  async respondToFriendRequest(requestId: string, action: 'accept' | 'decline') {
    return this.edgeRequest('/friends/respond', {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, action }),
    });
  }

  async removeFriend(friendUserId: string) {
    const user = await this.requireUser();

    const { error } = await supabase
      .from('friends')
      .delete()
      .or(`and(user_id.eq.${user.id},friend_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_id.eq.${user.id})`);

    if (error) throw error;
    return { success: true };
  }

  async getGroupUnreadCounts(): Promise<{
    groupUnreadById: Record<string, number>;
    channelUnreadById: Record<string, number>;
  }> {
    const { data, error } = await supabase.rpc('get_group_unread_counts');
    if (error) {
      const message = String(error.message || '');
      if (/does not exist|PGRST202|42883/i.test(message)) {
        return { groupUnreadById: {}, channelUnreadById: {} };
      }
      throw error;
    }

    const groupUnreadById: Record<string, number> = {};
    const channelUnreadById: Record<string, number> = {};

    for (const row of (data || []) as Array<{
      group_id: string;
      channel_id: string;
      unread_count: number | string;
    }>) {
      const count = Number(row.unread_count) || 0;
      channelUnreadById[row.channel_id] = count;
      groupUnreadById[row.group_id] = (groupUnreadById[row.group_id] || 0) + count;
    }

    return { groupUnreadById, channelUnreadById };
  }

  async markGroupChannelRead(channelId: string, readAt?: string) {
    const { error } = await supabase.rpc('mark_group_channel_read', {
      p_channel_id: channelId,
      p_read_at: readAt ?? new Date().toISOString(),
    });
    if (error) {
      const message = String(error.message || '');
      if (/does not exist|PGRST202|42883/i.test(message)) {
        localStorage.setItem(`blyve_group_channel_last_read_${channelId}`, readAt ?? new Date().toISOString());
        return;
      }
      throw error;
    }
  }

  async uploadGroupIcon(file: File) {
    const user = await this.requireUser();

    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${user.id}/groups/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
    return publicUrl;
  }

  async createGroup(payload: {
    name: string;
    description?: string | null;
    is_private?: boolean;
    iconUrl?: string | null;
  }) {
    return this.edgeRequest('/groups/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getMyGroups() {
    return this.edgeRequest('/groups', { method: 'GET' });
  }

  async getGroupDetails(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}`, { method: 'GET' });
  }

  async getGroupChannels(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}/channels`, { method: 'GET' });
  }

  async getGroupInvite(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}/invite`, { method: 'GET' });
  }

  async refreshGroupInvite(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}/invite/refresh`, { method: 'POST' });
  }

  async joinGroupViaInvite(code: string) {
    return this.edgeRequest('/groups/join-invite', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async uploadChannelIcon(groupId: string, file: File) {
    const user = await this.requireUser();

    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${user.id}/channels/${groupId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
    return publicUrl;
  }

  async createGroupChannel(
    groupId: string,
    payload: { name: string; type?: 'text' | 'voice'; iconUrl?: string | null }
  ) {
    return this.edgeRequest(`/groups/${groupId}/channels`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateGroupChannel(
    groupId: string,
    channelId: string,
    payload: { name?: string; position?: number; iconUrl?: string | null }
  ) {
    return this.edgeRequest(`/groups/${groupId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteGroupChannel(groupId: string, channelId: string) {
    return this.edgeRequest(`/groups/${groupId}/channels/${channelId}`, { method: 'DELETE' });
  }

  async getVoiceChannelState(groupId: string, channelId: string) {
    return this.edgeRequest(`/groups/${groupId}/channels/${channelId}/voice`, { method: 'GET' });
  }

  async joinVoiceChannel(groupId: string, channelId: string, callType: 'audio' | 'video' = 'audio') {
    return this.edgeRequest(`/groups/${groupId}/channels/${channelId}/voice/join`, {
      method: 'POST',
      body: JSON.stringify({ callType }),
    });
  }

  async leaveVoiceChannel(groupId: string, channelId: string) {
    return this.edgeRequest(`/groups/${groupId}/channels/${channelId}/voice/leave`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async joinGroup(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({}) });
  }

  async leaveGroup(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}/leave`, { method: 'POST', body: JSON.stringify({}) });
  }

  async updateGroup(
    groupId: string,
    payload: {
      name?: string;
      description?: string | null;
      is_private?: boolean;
      iconUrl?: string | null;
    },
  ) {
    return this.edgeRequest(`/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteGroup(groupId: string) {
    return this.edgeRequest(`/groups/${groupId}`, { method: 'DELETE' });
  }

  async getGroupMessages(groupId: string, channelId: string) {
    const q = new URLSearchParams({ channel_id: channelId });
    return this.edgeRequest(`/groups/${groupId}/messages?${q.toString()}`, { method: 'GET' });
  }

  async getLinkPreview(url: string) {
    const q = new URLSearchParams({ url });
    const payload = await this.edgeRequest(`/link-preview?${q.toString()}`, { method: 'GET' });
    return payload?.preview ?? null;
  }

  async getSocialOEmbed(provider: 'instagram' | 'tiktok' | 'x', url: string): Promise<unknown> {
    const q = new URLSearchParams({ provider, url });
    const payload = await this.edgeRequest(`/social-oembed?${q.toString()}`, { method: 'GET' });
    if (payload?.ok && payload.data) return payload.data;
    return null;
  }

  async sendGroupMessage(
    groupId: string,
    content: string,
    channelId: string,
    replyToMessageId?: string | null,
    attachmentIds?: string[],
  ) {
    return this.edgeRequest(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        channel_id: channelId,
        reply_to_message_id: replyToMessageId ?? null,
        attachment_ids: attachmentIds?.length ? attachmentIds : undefined,
      }),
    });
  }

  async updateGroupMessage(groupId: string, messageId: string, content: string) {
    return this.edgeRequest(`/groups/${groupId}/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteGroupMessage(groupId: string, messageId: string) {
    return this.edgeRequest(`/groups/${groupId}/messages/${messageId}`, { method: 'DELETE' });
  }

  private async callFunction(functionName: string, init: RequestInit = {}) {
    const token = await this.getFreshAccessToken();
    if (!token) throw new Error('Not authenticated');
    if (!SUPABASE_URL) throw new Error('Missing VITE_SUPABASE_URL');

    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/${functionName}`;
    const makeHeaders = (tok: string): HeadersInit => ({
      Authorization: `Bearer ${tok}`,
      apikey: SUPABASE_ANON_KEY,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    });

    let response = await fetch(url, { ...init, headers: makeHeaders(token) });

    if (response.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      const newToken = refreshed?.session?.access_token ?? null;
      if (newToken && newToken !== token) {
        this.setAccessToken(newToken);
        response = await fetch(url, { ...init, headers: makeHeaders(newToken) });
      }
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  /** Jitsi join via smart-action (alternative to joinCall). room_name is server-side only. */
  async getJitsiJoinViaSmartAction(sessionId: string, inviteToken?: string) {
    const token = await this.getFreshAccessToken();
    if (!token) throw new Error('Not authenticated');
    const { data, error } = await supabase.functions.invoke('smart-action', {
      body: { action: 'jitsi-join', sessionId, inviteToken },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) {
      throw new Error(error.message || 'Failed to join Jitsi call');
    }
    return data;
  }

  private async jitsiEdgeRequest(path: string, init: RequestInit = {}) {
    try {
      return await this.edgeRequest(path, init);
    } catch (primaryError) {
      const match = path.match(/^\/calls\/jitsi\/([^/]+)\/(accept|join|invite|end|leave)$/);
      if (match) {
        const [, sessionId, action] = match;
        const fn =
          action === 'accept' ? 'accept-call'
          : action === 'join' ? 'join-call'
          : action === 'invite' ? 'invite-participant'
          : 'end-call';
        const body = init.body ? JSON.parse(String(init.body)) : {};
        return this.callFunction(fn, {
          method: 'POST',
          body: JSON.stringify({ sessionId, ...body }),
        });
      }
      if (path === '/calls/jitsi/create') {
        return this.callFunction('create-call-session', init);
      }
      throw primaryError;
    }
  }

  /** Jitsi path — blyve /calls/jitsi/create with standalone fallback */
  async createCallSession(payload: {
    callType: 'audio' | 'video' | 'screen';
    contextType: 'direct' | 'group';
    conversationId?: string | null;
    groupId?: string | null;
    participantIds?: string[];
    generateInviteLink?: boolean;
    inviteExpiresInMinutes?: number;
  }) {
    return this.jitsiEdgeRequest('/calls/jitsi/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async acceptCall(
    sessionId: string,
    action: 'accept' | 'decline' | 'missed' = 'accept'
  ) {
    return this.jitsiEdgeRequest(`/calls/jitsi/${sessionId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  }

  async joinCall(sessionId: string, inviteToken?: string) {
    const body: { sessionId: string; inviteToken?: string } = { sessionId };
    if (inviteToken) body.inviteToken = inviteToken;
    return this.jitsiEdgeRequest(`/calls/jitsi/${sessionId}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async inviteCallParticipant(
    sessionId: string,
    userId: string,
    options?: { generateInviteLink?: boolean; inviteExpiresInMinutes?: number }
  ) {
    return this.jitsiEdgeRequest(`/calls/jitsi/${sessionId}/invite`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        generateInviteLink: options?.generateInviteLink,
        inviteExpiresInMinutes: options?.inviteExpiresInMinutes,
      }),
    });
  }

  /** LiveKit path — blyve /calls/:id/respond */
  /** Jitsi end — blyve /calls/jitsi/:id/end with standalone fallback */
  async endCallSession(sessionId: string) {
    return this.jitsiEdgeRequest(`/calls/jitsi/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  /** LiveKit end — blyve /calls/:id/end */
  async leaveCallSession(callSessionId: string) {
    try {
      return await this.edgeRequest(`/calls/${callSessionId}/leave`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (/\(404\)|\b404\b|not found/i.test(m)) {
        return this.edgeRequest(`/calls/${callSessionId}/respond`, {
          method: 'POST',
          body: JSON.stringify({ action: 'leave' }),
        });
      }
      throw e;
    }
  }

  /** Leave call — direct Jitsi calls end immediately for all participants. */
  async leaveCallParticipant(callSessionId: string) {
    if (isJitsiCallProvider()) {
      return this.jitsiEdgeRequest(`/calls/jitsi/${callSessionId}/leave`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: callSessionId }),
      });
    }

    return this.leaveCallSession(callSessionId);
  }
}

export const api = new ApiClient();
