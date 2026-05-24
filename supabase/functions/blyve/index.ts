// Deno type declarations for TypeScript editor
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore - Deno npm: imports are valid at runtime
import { Hono } from "npm:hono";
// @ts-ignore - Deno npm: imports are valid at runtime
import { cors } from "npm:hono/cors";
// @ts-ignore - Deno npm: imports are valid at runtime
import { logger } from "npm:hono/logger";
// @ts-ignore - Deno jsr: imports are valid at runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
// @ts-ignore - Deno npm: imports are valid at runtime
import type { Context } from "npm:hono";

// HINWEIS: seedData wurde entfernt, damit keine Fake-User mehr erstellt werden!
// Daten: profiles, conversations, messages, friends, groups (nur Kommunikation).

// Routes live under /blyve/... — aligned with Supabase edge logs (e.g. POST /blyve/groups/create).
// Local CLI uses full path /functions/v1/blyve/...; we strip /functions/v1 only (see normalizeEdgeRequest).
const app = new Hono().basePath("/blyve");

// ==================== SUPABASE CLIENTS ====================

// 1. ADMIN Client (Nur für Server-Startups wie Bucket-Erstellung)
const adminSupabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// 2. USER Client Helper (Für echte Requests)
const getSupabase = (c: Context) => {
  const authHeader = c.req.header('Authorization');
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader || '' } } }
  );
};

// ==================== SERVER STARTUP ====================

const initStorage = async () => {
  try {
    const bucketName = 'avatars';
    const { data: buckets } = await adminSupabase.storage.listBuckets();
    const bucketExists = buckets?.some(bucket => bucket.name === bucketName);
    if (!bucketExists) {
      await adminSupabase.storage.createBucket(bucketName, { public: true });
      console.log('Created avatars bucket');
    }
  } catch (error) {
    console.error('Failed to initialize storage:', error);
  }
};
initStorage();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Handle OPTIONS preflight requests explicitly (FIX für 401 Fehler!)
app.options("/*", (c) => {
  return c.text('', 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// ==================== AUTH ROUTES ====================

// Sign up new user
app.post("/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();

    const { data, error } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true,
    });

    if (error) {
      console.error(`Auth error during signup: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    const userId = data.user.id;
    
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .insert({
        id: userId,
        email,
        name,
        avatar_url: null,
        images: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Don't fail signup if profile creation fails - user can complete profile later
    }

    return c.json({ success: true, userId });
  } catch (error) {
    console.error(`Server error during signup: ${error}`);
    return c.json({ error: 'Signup failed' }, 500);
  }
});

// Sign in user
app.post("/auth/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const { data, error } = await userClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(`Auth error during signin: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    return c.json({
      accessToken: data.session.access_token,
      userId: data.user.id,
    });
  } catch (error) {
    console.error(`Server error during signin: ${error}`);
    return c.json({ error: 'Signin failed' }, 500);
  }
});

// ==================== USER PROFILE ROUTES ====================

app.get("/profile", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user || error) {
      return c.json({ error: 'Invalid or expired token', code: 401, message: error?.message || 'Unauthorized' }, 401);
    }

    // Get profile from database (not KV Store)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return c.json({ error: 'Profile not found' }, 404);
    }

    return c.json({ profile });
  } catch (error) {
    console.error(`Error fetching profile: ${error}`);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

app.put("/profile", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user || error) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const updates = await c.req.json();
    
    // Update profile in database (not KV Store)
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError || !updatedProfile) {
      console.error('Error updating profile:', updateError);
      return c.json({ error: 'Failed to update profile' }, 500);
    }

    return c.json({ success: true, profile: updatedProfile });
  } catch (error) {
    console.error(`Error updating profile: ${error}`);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

app.post("/profile/picture", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user || error) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const fileName = `${user.id}-${Date.now()}.jpg`;
    const bucketName = 'avatars';
    const arrayBuffer = await file.arrayBuffer();
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return c.json({ error: 'Failed to upload image to storage' }, 500);
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    // Get current profile from database
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .single();
    
    if (!currentProfile) {
      return c.json({ error: 'Profile not found' }, 404);
    }

    const updates: any = {
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    };

    // Update profile in database
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (updateError || !updatedProfile) {
      console.error('Error updating profile with image:', updateError);
      return c.json({ error: 'Failed to update profile' }, 500);
    }

    return c.json({ 
      success: true, 
      imageUrl: publicUrl, 
      profile: updatedProfile 
    });
  } catch (error) {
    console.error(`Profile picture upload - server error: ${error}`);
    return c.json({ error: 'Failed to upload profile picture' }, 500);
  }
});

/** Public lookup by unique username (for deep links / share). */
app.get("/user/:username", async (c) => {
  try {
    const raw = c.req.param("username") ?? "";
    const username = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (username.length < 3) {
      return c.json({ error: "Invalid username" }, 400);
    }
    const { data, error } = await adminSupabase
      .from("profiles")
      .select("id, username, display_name, name, avatar_url")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      return c.json({ error: error.message }, 500);
    }
    if (!data) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json({
      id: data.id,
      username: data.username,
      display_name: data.display_name ?? data.name,
      avatar_url: data.avatar_url,
    });
  } catch (e) {
    console.error("GET /user/:username", e);
    return c.json({ error: "Failed" }, 500);
  }
});

app.post("/user/online", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!user || error) return c.json({ error: 'Unauthorized' }, 401);

    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', user.id);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false });
  }
});

// ================= FRIENDS API =================

app.post("/friends/request", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const { friend_username } = await c.req.json();
    const normalized = String(friend_username || '').trim().replace(/^@/, '').toLowerCase();
    if (normalized.length < 3) {
      return c.json({ error: 'Invalid username' }, 400);
    }

    const { data: friend, error: friendError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .maybeSingle();

    if (friendError) return c.json({ error: friendError.message }, 500);
    if (!friend) return c.json({ error: 'User not found' }, 404);
    if (friend.id === user.id) return c.json({ error: 'Cannot add yourself' }, 400);

    const { data: existing, error: existingError } = await supabase
      .from('friends')
      .select('id, status')
      .or(`and(user_id.eq.${user.id},friend_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_id.eq.${user.id})`)
      .limit(1)
      .maybeSingle();

    if (existingError) return c.json({ error: existingError.message }, 500);
    if (existing) return c.json({ error: 'Request exists' }, 400);

    const { error: insertError } = await supabase.from('friends').insert({
      user_id: user.id,
      friend_id: friend.id,
      status: 'pending',
    });

    if (insertError) return c.json({ error: insertError.message }, 500);
    return c.json({ success: true });
  } catch (error) {
    console.error('POST /friends/request failed:', error);
    return c.json({ error: 'Request failed' }, 500);
  }
});

app.get("/friends", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const { data: outgoingRows, error: outgoingError } = await supabase
      .from('friends')
      .select(`
        id,
        user_id,
        friend_id,
        status,
        created_at,
        friend:friend_id(id, display_name, name, username, avatar_url, images)
      `)
      .eq('user_id', user.id)
      .in('status', ['accepted', 'pending'])
      .order('created_at', { ascending: false });

    if (outgoingError) return c.json({ error: outgoingError.message }, 500);

    const { data: incomingRows, error: incomingError } = await supabase
      .from('friends')
      .select(`
        id,
        user_id,
        friend_id,
        status,
        created_at,
        requester:user_id(id, display_name, name, username, avatar_url, images)
      `)
      .eq('friend_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (incomingError) return c.json({ error: incomingError.message }, 500);

    const friends = (outgoingRows || []).filter((row: any) => row.status === 'accepted');
    const outgoing_requests = (outgoingRows || []).filter((row: any) => row.status === 'pending');
    const incoming_requests = incomingRows || [];

    return c.json({ friends, outgoing_requests, incoming_requests });
  } catch (error) {
    console.error('GET /friends failed:', error);
    return c.json({ error: 'Friends fetch failed' }, 500);
  }
});

app.post("/friends/respond", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const { request_id, action } = await c.req.json();
    if (!request_id || !['accept', 'decline'].includes(action)) {
      return c.json({ error: 'Invalid payload' }, 400);
    }

    const { data: requestRow, error: requestError } = await supabase
      .from('friends')
      .select('id, user_id, friend_id, status')
      .eq('id', request_id)
      .eq('friend_id', user.id)
      .maybeSingle();

    if (requestError) return c.json({ error: requestError.message }, 500);
    if (!requestRow) return c.json({ error: 'Request not found' }, 404);
    if (requestRow.status !== 'pending') return c.json({ error: 'Request already handled' }, 400);

    if (action === 'decline') {
      const { error: deleteError } = await supabase
        .from('friends')
        .delete()
        .eq('id', request_id)
        .eq('friend_id', user.id);

      if (deleteError) return c.json({ error: deleteError.message }, 500);
      return c.json({ success: true });
    }

    const { error: updateError } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', request_id)
      .eq('friend_id', user.id);
    if (updateError) return c.json({ error: updateError.message }, 500);

    const { error: upsertError } = await supabase
      .from('friends')
      .upsert(
        {
          user_id: requestRow.friend_id,
          friend_id: requestRow.user_id,
          status: 'accepted',
        },
        { onConflict: 'user_id,friend_id' }
      );
    if (upsertError) return c.json({ error: upsertError.message }, 500);

    return c.json({ success: true, friend_user_id: requestRow.user_id });
  } catch (error) {
    console.error('POST /friends/respond failed:', error);
    return c.json({ error: 'Response failed' }, 500);
  }
});

// ==================== GROUPS / CHANNELS API ====================
// Route order: static paths before :groupId

app.post("/groups/create", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { name, description, is_private, iconUrl, icon_url } = await c.req.json();

    const cleanName = String(name || "").trim();
    const cleanDescription =
      description == null ? null : String(description).trim();
    const iconRaw = iconUrl ?? icon_url;
    let cleanIconUrl: string | null = null;
    if (iconRaw != null && String(iconRaw).trim() !== "") {
      const url = String(iconRaw).trim();
      if (url.length > 2048 || !/^https:\/\/.+/i.test(url)) {
        return c.json({ error: "Invalid icon URL" }, 400);
      }
      cleanIconUrl = url;
    }

    if (cleanName.length < 2 || cleanName.length > 60) {
      return c.json({ error: "Group name must be between 2 and 60 characters" }, 400);
    }

    if (cleanDescription && cleanDescription.length > 500) {
      return c.json({ error: "Description too long" }, 400);
    }

    const { data: group, error: createError } = await supabase
      .from("groups")
      .insert({
        name: cleanName,
        description: cleanDescription,
        creator_id: user.id,
        is_private: !!is_private,
        icon_url: cleanIconUrl,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (createError || !group) {
      return c.json({ error: createError?.message || "Failed to create group" }, 500);
    }

    return c.json({ success: true, group });
  } catch (error) {
    console.error("POST /groups/create failed:", error);
    return c.json({ error: "Failed to create group" }, 500);
  }
});

app.get("/groups/public", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: joinedRows, error: joinedError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);

    if (joinedError) {
      return c.json({ error: joinedError.message }, 500);
    }

    const joinedGroupIds = (joinedRows || []).map((row: { group_id: string }) => row.group_id);

    let query = supabase
      .from("groups")
      .select("*")
      .eq("is_private", false)
      .order("created_at", { ascending: false });

    if (joinedGroupIds.length > 0) {
      query = query.not("id", "in", `(${joinedGroupIds.join(",")})`);
    }

    const { data: groups, error: groupsError } = await query;

    if (groupsError) {
      return c.json({ error: groupsError.message }, 500);
    }

    return c.json({ groups: groups || [] });
  } catch (error) {
    console.error("GET /groups/public failed:", error);
    return c.json({ error: "Failed to list public groups" }, 500);
  }
});

app.get("/groups", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("group_members")
      .select(`
        id,
        role,
        joined_at,
        group:group_id (
          id,
          name,
          description,
          creator_id,
          is_private,
          icon_url,
          created_at,
          updated_at
        )
      `)
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false });

    if (membershipError) {
      return c.json({ error: membershipError.message }, 500);
    }

    return c.json({ groups: memberships || [] });
  } catch (error) {
    console.error("GET /groups failed:", error);
    return c.json({ error: "Failed to fetch groups" }, 500);
  }
});

app.get("/groups/:groupId/channels", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: channels, error: channelsError } = await supabase
      .from("group_channels")
      .select("id, group_id, name, position, type, icon_url, created_at")
      .eq("group_id", groupId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (channelsError) {
      return c.json({ error: channelsError.message }, 500);
    }

    return c.json({ channels: channels || [] });
  } catch (error) {
    console.error("GET /groups/:groupId/channels failed:", error);
    return c.json({ error: "Failed to fetch channels" }, 500);
  }
});

// @ts-ignore Deno relative import
import {
  handleCreateGroupChannel,
  handleDeleteGroupChannel,
  handleGetGroupInvite,
  handleGetVoiceChannelState,
  handleJoinGroupViaInvite,
  handleJoinVoiceChannel,
  handleLeaveVoiceChannel,
  handleRefreshGroupInvite,
  handleUpdateGroupChannel,
} from "./_shared/group-handlers.ts";

app.post("/groups/join-invite", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const result = await handleJoinGroupViaInvite(supabase, user, body);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("POST /groups/join-invite failed:", error);
    return c.json({ error: "Failed to join group via invite" }, 500);
  }
});

app.get("/groups/:groupId/invite", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const result = await handleGetGroupInvite(supabase, user, groupId);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("GET /groups/:groupId/invite failed:", error);
    return c.json({ error: "Failed to fetch group invite" }, 500);
  }
});

app.post("/groups/:groupId/invite/refresh", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const result = await handleRefreshGroupInvite(supabase, user, groupId);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("POST /groups/:groupId/invite/refresh failed:", error);
    return c.json({ error: "Failed to refresh group invite" }, 500);
  }
});

app.post("/groups/:groupId/channels", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const body = await c.req.json().catch(() => ({}));
    const result = await handleCreateGroupChannel(supabase, user, groupId, body);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("POST /groups/:groupId/channels failed:", error);
    return c.json({ error: "Failed to create channel" }, 500);
  }
});

app.patch("/groups/:groupId/channels/:channelId", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const channelId = c.req.param("channelId");
    const body = await c.req.json().catch(() => ({}));
    const result = await handleUpdateGroupChannel(supabase, user, groupId, channelId, body);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("PATCH /groups/:groupId/channels/:channelId failed:", error);
    return c.json({ error: "Failed to update channel" }, 500);
  }
});

app.delete("/groups/:groupId/channels/:channelId", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const channelId = c.req.param("channelId");
    const result = await handleDeleteGroupChannel(supabase, user, groupId, channelId);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("DELETE /groups/:groupId/channels/:channelId failed:", error);
    return c.json({ error: "Failed to delete channel" }, 500);
  }
});

app.get("/groups/:groupId/channels/:channelId/voice", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const channelId = c.req.param("channelId");
    const result = await handleGetVoiceChannelState(supabase, user, groupId, channelId);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("GET /groups/:groupId/channels/:channelId/voice failed:", error);
    return c.json({ error: "Failed to fetch voice channel state" }, 500);
  }
});

app.post("/groups/:groupId/channels/:channelId/voice/join", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const channelId = c.req.param("channelId");
    const body = await c.req.json().catch(() => ({}));
    const result = await handleJoinVoiceChannel(supabase, user, groupId, channelId, body);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("POST /groups/:groupId/channels/:channelId/voice/join failed:", error);
    return c.json({ error: "Failed to join voice channel" }, 500);
  }
});

app.post("/groups/:groupId/channels/:channelId/voice/leave", async (c) => {
  try {
    const supabase = getSupabase(c);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return c.json({ error: "Unauthorized" }, 401);
    const groupId = c.req.param("groupId");
    const channelId = c.req.param("channelId");
    const result = await handleLeaveVoiceChannel(supabase, user, groupId, channelId);
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("POST /groups/:groupId/channels/:channelId/voice/leave failed:", error);
    return c.json({ error: "Failed to leave voice channel" }, 500);
  }
});

app.get("/groups/:groupId", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      return c.json({ error: "Group not found" }, 404);
    }

    const { data: myMembership, error: myMemError } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (myMemError) {
      return c.json({ error: myMemError.message }, 500);
    }
    if (!myMembership) {
      return c.json({ error: "Not a member of this group" }, 403);
    }

    const { data: members, error: membersError } = await adminSupabase
      .from("group_members")
      .select(`
        id,
        role,
        joined_at,
        user:user_id (
          id,
          username,
          display_name,
          avatar_url,
          bio
        )
      `)
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });

    if (membersError) {
      return c.json({ error: membersError.message }, 500);
    }

    return c.json({ group, members: members || [] });
  } catch (error) {
    console.error("GET /groups/:groupId failed:", error);
    return c.json({ error: "Failed to fetch group details" }, 500);
  }
});

app.post("/groups/:groupId/join", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id, is_private")
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      return c.json({ error: "Group not found" }, 404);
    }

    if (group.is_private) {
      return c.json({ error: "Private group requires invite" }, 403);
    }

    const { error: joinError } = await supabase
      .from("group_members")
      .upsert(
        {
          group_id: groupId,
          user_id: user.id,
          role: "member",
        },
        { onConflict: "group_id,user_id" }
      );

    if (joinError) {
      return c.json({ error: joinError.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("POST /groups/:groupId/join failed:", error);
    return c.json({ error: "Failed to join group" }, 500);
  }
});

app.post("/groups/:groupId/leave", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("id, role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      return c.json({ error: membershipError.message }, 500);
    }

    if (!membership) {
      return c.json({ error: "Not a member of this group" }, 404);
    }

    const { error: leaveError } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);

    if (leaveError) {
      return c.json({ error: leaveError.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("POST /groups/:groupId/leave failed:", error);
    return c.json({ error: "Failed to leave group" }, 500);
  }
});

app.get("/groups/:groupId/messages", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const channelId = c.req.query("channel_id") || "";
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!channelId) {
      return c.json({ error: "channel_id query parameter required" }, 400);
    }

    const { data: channelRow, error: channelError } = await supabase
      .from("group_channels")
      .select("id")
      .eq("id", channelId)
      .eq("group_id", groupId)
      .maybeSingle();

    if (channelError || !channelRow) {
      return c.json({ error: "Channel not found" }, 404);
    }

    const { data: messages, error: messagesError } = await supabase
      .from("group_messages")
      .select(`
        id,
        group_id,
        channel_id,
        sender_id,
        content,
        created_at,
        updated_at,
        sender:sender_id (
          id,
          username,
          display_name,
          avatar_url
        )
      `)
      .eq("group_id", groupId)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return c.json({ error: messagesError.message }, 500);
    }

    return c.json({ messages: messages || [] });
  } catch (error) {
    console.error("GET /groups/:groupId/messages failed:", error);
    return c.json({ error: "Failed to fetch messages" }, 500);
  }
});

app.post("/groups/:groupId/messages", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { content, channel_id: channelIdBody } = await c.req.json();
    const cleanContent = String(content || "").trim();
    const channelId = String(channelIdBody || "").trim();

    if (!cleanContent) {
      return c.json({ error: "Message content required" }, 400);
    }

    if (!channelId) {
      return c.json({ error: "channel_id required" }, 400);
    }

    if (cleanContent.length > 4000) {
      return c.json({ error: "Message too long" }, 400);
    }

    const { data: channelRow, error: channelErr } = await supabase
      .from("group_channels")
      .select("id, type")
      .eq("id", channelId)
      .eq("group_id", groupId)
      .maybeSingle();

    if (channelErr || !channelRow) {
      return c.json({ error: "Channel not found" }, 404);
    }

    if (channelRow.type === "voice") {
      return c.json({ error: "Cannot send messages in a voice channel" }, 400);
    }

    const { data: message, error: insertError } = await supabase
      .from("group_messages")
      .insert({
        group_id: groupId,
        channel_id: channelId,
        sender_id: user.id,
        content: cleanContent,
      })
      .select(`
        id,
        group_id,
        channel_id,
        sender_id,
        content,
        created_at,
        updated_at,
        sender:sender_id (
          id,
          username,
          display_name,
          avatar_url
        )
      `)
      .single();

    if (insertError || !message) {
      return c.json({ error: insertError?.message || "Failed to send message" }, 500);
    }

    const { error: touchError } = await supabase
      .from("groups")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", groupId);

    if (touchError) {
      console.error("Failed to update group timestamp:", touchError);
    }

    return c.json({ success: true, message });
  } catch (error) {
    console.error("POST /groups/:groupId/messages failed:", error);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

app.put("/groups/:groupId/messages/:messageId", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const messageId = c.req.param("messageId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { content } = await c.req.json();
    const cleanContent = String(content || "").trim();

    if (!cleanContent) {
      return c.json({ error: "Message content required" }, 400);
    }

    if (cleanContent.length > 4000) {
      return c.json({ error: "Message too long" }, 400);
    }

    const { data: updatedMessage, error: updateError } = await supabase
      .from("group_messages")
      .update({ content: cleanContent, updated_at: new Date().toISOString() })
      .eq("id", messageId)
      .eq("group_id", groupId)
      .eq("sender_id", user.id)
      .select(`
        id,
        group_id,
        channel_id,
        sender_id,
        content,
        created_at,
        updated_at,
        sender:sender_id (
          id,
          username,
          display_name,
          avatar_url
        )
      `)
      .single();

    if (updateError || !updatedMessage) {
      return c.json({ error: updateError?.message || "Failed to update message" }, 500);
    }

    return c.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error("PUT /groups/:groupId/messages/:messageId failed:", error);
    return c.json({ error: "Failed to update message" }, 500);
  }
});

app.delete("/groups/:groupId/messages/:messageId", async (c) => {
  try {
    const supabase = getSupabase(c);
    const groupId = c.req.param("groupId");
    const messageId = c.req.param("messageId");
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { data: myMembership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    const isAdmin = myMembership?.role === "admin";

    let deleteQuery = supabase
      .from("group_messages")
      .delete()
      .eq("id", messageId)
      .eq("group_id", groupId);

    if (!isAdmin) {
      deleteQuery = deleteQuery.eq("sender_id", user.id);
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      return c.json({ error: deleteError.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("DELETE /groups/:groupId/messages/:messageId failed:", error);
    return c.json({ error: "Failed to delete message" }, 500);
  }
});

// ==================== CALLS (LiveKit legacy + Jitsi parallel) ====================

// @ts-ignore Deno relative import
import {
  handleAcceptCall,
  handleCreateCallSession,
  handleEndCall,
  handleInviteParticipant,
  handleJoinCall,
} from "./_shared/jitsi-call-handlers.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_RINGING_TIMEOUT_MS = 30_000;

function isUuid(s: string): boolean {
  return typeof s === "string" && UUID_RE.test(s);
}

async function requireUser(c: Context) {
  const supabase = getSupabase(c);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: c.json({ error: "Unauthorized", code: 401 }, 401) as Response };
  }
  return { supabase, user };
}

async function expireStaleRingingCallIfNeeded(
  supabase: any,
  callSessionId: string
): Promise<{ expired: boolean; status?: string }> {
  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, status, created_at, updated_at")
    .eq("id", callSessionId)
    .maybeSingle();
  if (sErr || !session) return { expired: false };

  const status = String((session as { status?: string }).status || "").toLowerCase();
  if (status !== "ringing") return { expired: false, status };

  const basisIso =
    (session as { updated_at?: string | null }).updated_at ||
    (session as { created_at?: string | null }).created_at ||
    null;
  if (!basisIso) return { expired: false, status };

  const basisTs = new Date(basisIso).getTime();
  if (!Number.isFinite(basisTs)) return { expired: false, status };
  if (Date.now() - basisTs <= CALL_RINGING_TIMEOUT_MS) return { expired: false, status };

  const endedAt = new Date().toISOString();
  await supabase
    .from("call_sessions")
    .update({ status: "missed", ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: parts } = await supabase
    .from("call_participants")
    .select("id, invite_status, left_at")
    .eq("call_session_id", callSessionId)
    .is("left_at", null);
  for (const p of (parts || []) as { id: string; invite_status: string; left_at: string | null }[]) {
    const invite = String(p.invite_status || "").toLowerCase();
    const nextInvite = invite === "accepted" ? "left" : invite === "pending" ? "missed" : invite;
    await supabase
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  return { expired: true, status: "missed" };
}

async function closeUnansweredCall(
  supabase: any,
  callSessionId: string,
  terminalStatus: "declined" | "missed"
): Promise<void> {
  const endedAt = new Date().toISOString();
  await supabase
    .from("call_sessions")
    .update({ status: terminalStatus, ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: parts } = await supabase
    .from("call_participants")
    .select("id, role, invite_status, left_at")
    .eq("call_session_id", callSessionId);
  for (const p of (parts || []) as { id: string; role: string; invite_status: string; left_at: string | null }[]) {
    if (p.left_at) continue;
    const role = String(p.role || "").toLowerCase();
    const invite = String(p.invite_status || "").toLowerCase();
    const nextInvite =
      role === "host" ? "left" : invite === "accepted" ? "left" : terminalStatus;
    await supabase
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }
}

/** Non-host: leave the LiveKit session without ending the call (used by /calls/:id/leave and respond action leave). */
async function participantSoftLeaveHandler(
  c: Context,
  supabase: any,
  user: { id: string },
  callSessionId: string
): Promise<Response> {
  const { data: myRow, error: pErr } = await supabase
    .from("call_participants")
    .select("id, role, invite_status, left_at")
    .eq("call_session_id", callSessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr) return c.json({ error: pErr.message, code: 500 }, 500);
  if (!myRow) return c.json({ error: "Not a participant", code: 403 }, 403);

  const me = myRow as { id: string; role: string; invite_status: string; left_at: string | null };
  if (me.role === "host") {
    return c.json({ success: true, callSessionId, skipped: true, reason: "host" });
  }
  if (me.invite_status !== "accepted") {
    return c.json({ success: true, callSessionId, skipped: true, reason: "not_accepted" });
  }
  if (me.left_at) {
    return c.json({ success: true, callSessionId, alreadyLeft: true });
  }

  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, status, conversation_id")
    .eq("id", callSessionId)
    .maybeSingle();
  if (sErr) return c.json({ error: sErr.message, code: 500 }, 500);
  if (!session) {
    return c.json({ success: true, callSessionId, skipped: true, reason: "not_found" });
  }
  const sess = session as { id: string; status: string };
  if (["ended", "cancelled", "declined", "missed"].includes(String(sess.status).toLowerCase())) {
    return c.json({ success: true, callSessionId, skipped: true, reason: "session_not_active" });
  }

  const leftAt = new Date().toISOString();
  const { error: uErr } = await supabase
    .from("call_participants")
    .update({ invite_status: "left", left_at: leftAt, updated_at: leftAt })
    .eq("id", me.id);
  if (uErr) return c.json({ error: uErr.message, code: 500 }, 500);

  await supabase.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: user.id,
    event_type: "left",
    payload: { soft: true },
  });

  return c.json({ success: true, callSessionId, left_at: leftAt });
}

/** Static Jitsi routes before :id — parallel to LiveKit /calls/create */
app.post("/calls/jitsi/create", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const body = await c.req.json().catch(() => ({}));
    const result = await handleCreateCallSession(auth.supabase, auth.user, body);
    return c.json(result.body, result.status);
  } catch (e) {
    console.error("POST /calls/jitsi/create", e);
    return c.json({ error: "Failed to create Jitsi call", code: 500 }, 500);
  }
});

app.post("/calls/jitsi/:id/accept", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const sessionId = c.req.param("id");
    if (!isUuid(sessionId)) return c.json({ error: "Invalid call id", code: 400 }, 400);
    const body = await c.req.json().catch(() => ({}));
    const action = String(body.action || "accept") as "accept" | "decline" | "missed";
    if (!["accept", "decline", "missed"].includes(action)) {
      return c.json({ error: "Invalid action", code: 400 }, 400);
    }
    const result = await handleAcceptCall(auth.supabase, auth.user, sessionId, action);
    return c.json(result.body, result.status);
  } catch (e) {
    console.error("POST /calls/jitsi/:id/accept", e);
    return c.json({ error: "Failed to accept Jitsi call", code: 500 }, 500);
  }
});

app.post("/calls/jitsi/:id/join", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const sessionId = c.req.param("id");
    if (!isUuid(sessionId)) return c.json({ error: "Invalid call id", code: 400 }, 400);
    const body = await c.req.json().catch(() => ({}));
    const inviteToken = body.inviteToken ? String(body.inviteToken) : undefined;
    const result = await handleJoinCall(auth.supabase, auth.user, sessionId, inviteToken, body);
    return c.json(result.body, result.status);
  } catch (e) {
    console.error("POST /calls/jitsi/:id/join", e);
    return c.json({ error: "Failed to join Jitsi call", code: 500 }, 500);
  }
});

app.post("/calls/jitsi/:id/invite", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const sessionId = c.req.param("id");
    if (!isUuid(sessionId)) return c.json({ error: "Invalid call id", code: 400 }, 400);
    const body = await c.req.json().catch(() => ({}));
    const userId = body.userId ? String(body.userId) : "";
    if (!isUuid(userId)) return c.json({ error: "Invalid userId", code: 400 }, 400);
    const result = await handleInviteParticipant(auth.supabase, auth.user, sessionId, userId, {
      generateInviteLink: Boolean(body.generateInviteLink),
      inviteExpiresInMinutes: body.inviteExpiresInMinutes,
    });
    return c.json(result.body, result.status);
  } catch (e) {
    console.error("POST /calls/jitsi/:id/invite", e);
    return c.json({ error: "Failed to invite participant", code: 500 }, 500);
  }
});

app.post("/calls/jitsi/:id/end", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const sessionId = c.req.param("id");
    if (!isUuid(sessionId)) return c.json({ error: "Invalid call id", code: 400 }, 400);
    const result = await handleEndCall(auth.supabase, auth.user, sessionId);
    return c.json(result.body, result.status);
  } catch (e) {
    console.error("POST /calls/jitsi/:id/end", e);
    return c.json({ error: "Failed to end Jitsi call", code: 500 }, 500);
  }
});

/** Static routes before :id — keep /calls/create before /calls/:id */
app.post("/calls/create", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const { supabase, user } = auth;

    const body = await c.req.json().catch(() => ({}));
    const callType = String(body.callType || "");
    const contextType = String(body.contextType || "");
    const conversationId = body.conversationId == null ? null : String(body.conversationId);
    const groupId = body.groupId == null ? null : String(body.groupId);
    const participantIdsRaw: unknown[] = Array.isArray(body.participantIds)
      ? body.participantIds
      : [];

    if (!["audio", "video", "screen"].includes(callType)) {
      return c.json({ error: "Invalid callType", code: 400 }, 400);
    }
    if (!["direct", "group"].includes(contextType)) {
      return c.json({ error: "Invalid contextType", code: 400 }, 400);
    }

    const rawParticipantStrings: string[] = participantIdsRaw.map((x) => String(x));
    let participantIds: string[] = [...new Set(rawParticipantStrings)].filter(
      (id) => isUuid(id) && id !== user.id,
    );

    if (contextType === "direct") {
      if (!conversationId || !isUuid(conversationId)) {
        return c.json({ error: "conversationId required for direct calls", code: 400 }, 400);
      }
      if (groupId) {
        return c.json({ error: "groupId must be null for direct calls", code: 400 }, 400);
      }
      const { data: conv, error: convErr } = await supabase
        .from("conversations")
        .select("id, user1_id, user2_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (convErr) return c.json({ error: convErr.message, code: 500 }, 500);
      if (!conv) return c.json({ error: "Conversation not found", code: 404 }, 404);
      const u1 = (conv as { user1_id: string; user2_id: string }).user1_id;
      const u2 = (conv as { user1_id: string; user2_id: string }).user2_id;
      if (user.id !== u1 && user.id !== u2) {
        return c.json({ error: "Not a participant in this conversation", code: 403 }, 403);
      }
      const peer = u1 === user.id ? u2 : u1;
      if (participantIds.length === 0) {
        participantIds.push(peer);
      } else if (participantIds.length !== 1 || participantIds[0] !== peer) {
        return c.json({ error: "participantIds must be exactly the other DM user", code: 400 }, 400);
      }
    } else {
      if (!groupId || !isUuid(groupId)) {
        return c.json({ error: "groupId required for group calls", code: 400 }, 400);
      }
      if (conversationId) {
        return c.json({ error: "conversationId must be null for group calls", code: 400 }, 400);
      }
      const { data: myMembership, error: memErr } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (memErr) return c.json({ error: memErr.message, code: 500 }, 500);
      if (!myMembership) {
        return c.json({ error: "Not a member of this group", code: 403 }, 403);
      }
      const { data: members, error: gmErr } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      if (gmErr) return c.json({ error: gmErr.message, code: 500 }, 500);
      const allowed = new Set((members || []).map((m: { user_id: string }) => m.user_id));
      for (const pid of participantIds) {
        if (!allowed.has(pid)) {
          return c.json({ error: `User ${pid} is not in this group`, code: 400 }, 400);
        }
      }
      if (participantIds.length === 0) {
        return c.json({ error: "participantIds must include at least one group member", code: 400 }, 400);
      }
    }

    const callSessionId = crypto.randomUUID();
    const roomName = `call_${callSessionId}`;

    const sessionRow = {
      id: callSessionId,
      call_type: callType,
      context_type: contextType,
      conversation_id: contextType === "direct" ? conversationId : null,
      group_id: contextType === "group" ? groupId : null,
      creator_id: user.id,
      room_name: roomName,
      status: "ringing",
    };

    const { error: csErr } = await supabase.from("call_sessions").insert(sessionRow);
    if (csErr) {
      console.error("call_sessions insert", csErr);
      return c.json({ error: csErr.message, code: 500 }, 500);
    }

    const { error: hostErr } = await supabase.from("call_participants").insert({
      call_session_id: callSessionId,
      user_id: user.id,
      role: "host",
      invite_status: "accepted",
      joined_at: new Date().toISOString(),
    });
    if (hostErr) {
      console.error("call_participants host insert", hostErr);
      await supabase.from("call_sessions").delete().eq("id", callSessionId);
      return c.json({ error: hostErr.message, code: 500 }, 500);
    }

    const inviteRows = participantIds.map((uid: string) => ({
      call_session_id: callSessionId,
      user_id: uid,
      role: "participant",
      invite_status: "pending",
    }));
    if (inviteRows.length > 0) {
      const { error: invErr } = await supabase.from("call_participants").insert(inviteRows);
      if (invErr) {
        console.error("call_participants invites", invErr);
        await supabase.from("call_sessions").delete().eq("id", callSessionId);
        return c.json({ error: invErr.message, code: 500 }, 500);
      }
    }

    const nowIso = new Date().toISOString();
    await supabase.from("call_events").insert([
      {
        call_session_id: callSessionId,
        user_id: user.id,
        event_type: "created",
        payload: { call_type: callType, context_type: contextType },
        created_at: nowIso,
      },
      {
        call_session_id: callSessionId,
        user_id: user.id,
        event_type: "ringing",
        payload: { room_name: roomName },
        created_at: nowIso,
      },
    ]);

    return c.json({
      callSessionId,
      roomName,
      status: "ringing",
    });
  } catch (e) {
    console.error("POST /calls/create", e);
    return c.json({ error: "Failed to create call", code: 500 }, 500);
  }
});

app.post("/calls/:id/respond", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const { supabase, user } = auth;
    const callSessionId = c.req.param("id");
    if (!isUuid(callSessionId)) {
      return c.json({ error: "Invalid call id", code: 400 }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (!["accept", "decline", "missed", "leave"].includes(action)) {
      return c.json({ error: "Invalid action", code: 400 }, 400);
    }

    const expiry = await expireStaleRingingCallIfNeeded(supabase, callSessionId);
    if (expiry.expired) {
      return c.json({ error: "Call expired", code: 410, status: expiry.status || "missed" }, 410);
    }

    if (action === "leave") {
      return await participantSoftLeaveHandler(c, supabase, user, callSessionId);
    }

    const { data: myRow, error: pErr } = await supabase
      .from("call_participants")
      .select("id, invite_status, call_session_id, role, joined_at")
      .eq("call_session_id", callSessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (pErr) return c.json({ error: pErr.message, code: 500 }, 500);
    if (!myRow) return c.json({ error: "Not a participant", code: 403 }, 403);

    const { data: session, error: sErr } = await supabase
      .from("call_sessions")
      .select("id, status, started_at")
      .eq("id", callSessionId)
      .maybeSingle();
    if (sErr) return c.json({ error: sErr.message, code: 500 }, 500);
    if (!session) return c.json({ error: "Call not found", code: 404 }, 404);

    const sess = session as { id: string; status: string; started_at: string | null };

    if (action === "accept") {
      const row = myRow as { id: string; joined_at: string | null };
      const updates: Record<string, unknown> = { invite_status: "accepted" };
      if (!row.joined_at) {
        updates.joined_at = new Date().toISOString();
      }
      const { error: uErr } = await supabase
        .from("call_participants")
        .update(updates)
        .eq("id", row.id);
      if (uErr) return c.json({ error: uErr.message, code: 500 }, 500);

      if (sess.status === "ringing") {
        const { error: actErr } = await supabase
          .from("call_sessions")
          .update({
            status: "active",
            started_at: sess.started_at || new Date().toISOString(),
          })
          .eq("id", callSessionId);
        if (actErr) return c.json({ error: actErr.message, code: 500 }, 500);
      }

      await supabase.from("call_events").insert({
        call_session_id: callSessionId,
        user_id: user.id,
        event_type: "accepted",
        payload: {},
      });
    } else if (action === "decline") {
      const { error: dErr } = await supabase
        .from("call_participants")
        .update({ invite_status: "declined" })
        .eq("id", (myRow as { id: string; joined_at: string | null }).id);
      if (dErr) return c.json({ error: dErr.message, code: 500 }, 500);
      await supabase.from("call_events").insert({
        call_session_id: callSessionId,
        user_id: user.id,
        event_type: "declined",
        payload: {},
      });
      if (sess.status === "ringing") {
        await closeUnansweredCall(supabase, callSessionId, "declined");
      }
    } else {
      const { error: mErr } = await supabase
        .from("call_participants")
        .update({ invite_status: "missed" })
        .eq("id", (myRow as { id: string; joined_at: string | null }).id);
      if (mErr) return c.json({ error: mErr.message, code: 500 }, 500);
      await supabase.from("call_events").insert({
        call_session_id: callSessionId,
        user_id: user.id,
        event_type: "missed",
        payload: {},
      });
      if (sess.status === "ringing") {
        await closeUnansweredCall(supabase, callSessionId, "missed");
      }
    }

    const { data: participants, error: listErr } = await supabase
      .from("call_participants")
      .select("user_id, role, invite_status, joined_at, left_at")
      .eq("call_session_id", callSessionId);
    if (listErr) return c.json({ error: listErr.message, code: 500 }, 500);

    return c.json({
      callSessionId,
      participants: participants || [],
    });
  } catch (e) {
    console.error("POST /calls/:id/respond", e);
    return c.json({ error: "Failed to respond", code: 500 }, 500);
  }
});

/** Participant leaves the LiveKit room without ending the call (host should use /end). */
app.post("/calls/:id/leave", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const { supabase, user } = auth;
    const callSessionId = c.req.param("id");
    if (!isUuid(callSessionId)) {
      return c.json({ error: "Invalid call id", code: 400 }, 400);
    }
    const expiry = await expireStaleRingingCallIfNeeded(supabase, callSessionId);
    if (expiry.expired) {
      return c.json({ success: true, callSessionId, status: expiry.status || "missed", expired: true });
    }

    return await participantSoftLeaveHandler(c, supabase, user, callSessionId);
  } catch (e) {
    console.error("POST /calls/:id/leave", e);
    return c.json({ error: "Failed to leave call", code: 500 }, 500);
  }
});

app.post("/calls/:id/end", async (c) => {
  try {
    const auth = await requireUser(c);
    if ("error" in auth) return auth.error;
    const { supabase, user } = auth;
    const callSessionId = c.req.param("id");
    if (!isUuid(callSessionId)) {
      return c.json({ error: "Invalid call id", code: 400 }, 400);
    }

    const { data: session, error: sErr } = await supabase
      .from("call_sessions")
      .select("id, creator_id, status")
      .eq("id", callSessionId)
      .maybeSingle();
    if (sErr) return c.json({ error: sErr.message, code: 500 }, 500);
    if (!session) return c.json({ error: "Call not found", code: 404 }, 404);

    const sess = session as { creator_id: string; status: string };

    const { data: myPart, error: mpErr } = await supabase
      .from("call_participants")
      .select("role")
      .eq("call_session_id", callSessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (mpErr) return c.json({ error: mpErr.message, code: 500 }, 500);
    if (!myPart) return c.json({ error: "Not a participant", code: 403 }, 403);

    const isHostRole = (myPart as { role: string }).role === "host";
    const isCreator = sess.creator_id === user.id;
    if (!isCreator && !isHostRole) {
      return c.json({ error: "Only the creator or host can end the call", code: 403 }, 403);
    }

    if (["ended", "cancelled", "declined"].includes(sess.status)) {
      return c.json({ success: true, status: sess.status });
    }

    const endedAt = new Date().toISOString();
    const { error: endErr } = await supabase
      .from("call_sessions")
      .update({ status: "ended", ended_at: endedAt })
      .eq("id", callSessionId);
    if (endErr) return c.json({ error: endErr.message, code: 500 }, 500);

    const { data: parts, error: lpErr } = await supabase
      .from("call_participants")
      .select("id, invite_status, left_at")
      .eq("call_session_id", callSessionId);
    if (!lpErr && parts) {
      for (const p of parts as { id: string; invite_status: string; left_at: string | null }[]) {
        if (p.left_at) continue;
        if (p.invite_status === "accepted") {
          await supabase
            .from("call_participants")
            .update({ invite_status: "left", left_at: endedAt })
            .eq("id", p.id);
        } else if (p.invite_status === "pending") {
          await supabase
            .from("call_participants")
            .update({ invite_status: "removed", left_at: endedAt })
            .eq("id", p.id);
        }
      }
    }

    await supabase.from("call_events").insert({
      call_session_id: callSessionId,
      user_id: user.id,
      event_type: "ended",
      payload: {},
    });

    return c.json({ success: true, status: "ended", ended_at: endedAt });
  } catch (e) {
    console.error("POST /calls/:id/end", e);
    return c.json({ error: "Failed to end call", code: 500 }, 500);
  }
});

/**
 * Local: `supabase functions serve` path is `/functions/v1/blyve/groups/...`.
 * Hosted: path is usually already `/blyve/groups/...` (aligns with Hono basePath `/blyve`).
 * Strip only `/functions/v1` so the remainder is `/blyve/...`.
 * Collapse accidental `/blyve/blyve/` (bad client path) to `/blyve/`.
 */
function normalizeEdgeRequest(req: Request): Request {
  const url = new URL(req.url);
  const originalPath = url.pathname;
  let pathname = originalPath;

  if (pathname.startsWith("/functions/v1/")) {
    pathname = pathname.slice("/functions/v1".length);
    if (!pathname.startsWith("/")) {
      pathname = `/${pathname}`;
    }
  }

  while (pathname.startsWith("/blyve/blyve")) {
    pathname = "/blyve" + pathname.slice("/blyve/blyve".length);
  }

  // Some gateways strip only `/functions/v1` and leave `/groups/...` (no `/blyve` segment).
  if (!pathname.startsWith("/blyve")) {
    const roots = [
      "/groups",
      "/friends",
      "/calls",
      "/auth",
      "/health",
      "/profile",
      "/user",
    ];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(`${root}/`)) {
        pathname = `/blyve${pathname}`;
        break;
      }
    }
  }

  if (pathname === originalPath) {
    return req;
  }
  url.pathname = pathname;
  return new Request(url, req);
}

Deno.serve((req: Request) => app.fetch(normalizeEdgeRequest(req)));
