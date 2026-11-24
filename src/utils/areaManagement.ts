import { SupabaseClient } from '@supabase/supabase-js';
import { LibraryArea, UserProfile } from '../types/lirc';

export const AREAS_BROADCAST_CHANNEL = 'lirc_areas_realtime';

/**
 * Broadcast an area change to all open tabs.
 */
export function broadcastAreasChange() {
  if (typeof window === 'undefined') return;
  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(AREAS_BROADCAST_CHANNEL);
      channel.postMessage({ type: 'AREAS_UPDATED', timestamp: Date.now() });
      channel.close();
    }
  } catch {
    // ignore
  }
}

/**
 * Save (insert or update) a library area.
 */
export async function saveLibraryArea(
  supabase: SupabaseClient,
  area: {
    id?: number;
    code: string;
    name: string;
    description?: string;
    floor_location?: string;
    capacity: number;
    color_hex?: string;
    icon_name?: string;
    display_order?: number;
    is_active?: boolean;
  },
  profile: UserProfile
): Promise<LibraryArea> {
  const cleanCode = area.code.trim().toUpperCase();
  const cleanName = area.name.trim();
  const cleanSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    // Attempt via RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('manage_library_area', {
      p_id: area.id || null,
      p_code: cleanCode,
      p_name: cleanName,
      p_description: area.description || '',
      p_floor_location: area.floor_location || 'Main Library',
      p_capacity: Math.max(1, Math.min(2000, Number(area.capacity) || 60)),
      p_color_hex: area.color_hex || '#2E5A44',
      p_icon_name: area.icon_name || 'BookOpen',
      p_display_order: area.display_order ?? null,
      p_is_active: area.is_active ?? true,
    });

    if (!rpcErr && rpcData) {
      broadcastAreasChange();
      return rpcData as LibraryArea;
    }
  } catch (err) {
    console.warn('RPC manage_library_area fallback to direct table operation:', err);
  }

  // Fallback: direct table insert or update
  let resultArea: LibraryArea;
  if (area.id) {
    const { data, error } = await supabase
      .from('library_areas')
      .update({
        code: cleanCode,
        name: cleanName,
        description: area.description || '',
        floor_location: area.floor_location || 'Main Library',
        capacity: Math.max(1, Math.min(2000, Number(area.capacity) || 60)),
        color_hex: area.color_hex || '#2E5A44',
        icon_name: area.icon_name || 'BookOpen',
        display_order: area.display_order ?? 1,
        is_active: area.is_active ?? true,
      })
      .eq('id', area.id)
      .select()
      .single();

    if (error) throw error;
    resultArea = data as LibraryArea;
  } else {
    // Generate order if needed
    const { count } = await supabase.from('library_areas').select('*', { count: 'exact', head: true });
    const nextOrder = (count || 0) + 1;

    const { data, error } = await supabase
      .from('library_areas')
      .insert({
        code: cleanCode,
        slug: cleanSlug,
        name: cleanName,
        description: area.description || '',
        floor_location: area.floor_location || 'Main Library',
        capacity: Math.max(1, Math.min(2000, Number(area.capacity) || 60)),
        color_hex: area.color_hex || '#2E5A44',
        icon_name: area.icon_name || 'BookOpen',
        display_order: area.display_order ?? nextOrder,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    resultArea = data as LibraryArea;
  }

  // Log client activity
  try {
    await supabase.rpc('log_client_activity', {
      p_action_type: 'area_updated',
      p_description: `${profile.full_name} ${area.id ? 'updated' : 'added'} library area: ${cleanName} (${cleanCode})`,
      p_target_type: 'library_area',
      p_target_id: String(resultArea.id),
      p_metadata: { area_id: resultArea.id, name: cleanName, code: cleanCode, capacity: resultArea.capacity },
    });
  } catch {
    // non-fatal
  }

  broadcastAreasChange();
  return resultArea;
}

/**
 * Remove or deactivate a library area safely.
 */
export async function removeLibraryArea(
  supabase: SupabaseClient,
  area: LibraryArea,
  profile: UserProfile,
  forceHardDelete = false
): Promise<{ success: boolean; deactivated: boolean; message: string }> {
  try {
    // Attempt RPC
    const { data: rpcSuccess, error: rpcErr } = await supabase.rpc('delete_or_deactivate_library_area', {
      p_id: area.id,
      p_hard_delete: forceHardDelete,
    });

    if (!rpcErr) {
      broadcastAreasChange();
      return {
        success: true,
        deactivated: true,
        message: `Library area "${area.name}" successfully updated.`,
      };
    }
  } catch (err) {
    console.warn('RPC delete_or_deactivate_library_area fallback:', err);
  }

  // Check if historical records exist
  const { count: recordCount } = await supabase
    .from('occupancy_records')
    .select('id', { count: 'exact', head: true })
    .eq('area_id', area.id);

  if ((recordCount || 0) > 0 || !forceHardDelete) {
    // Soft-deactivate to protect historical attendance data
    const { error } = await supabase
      .from('library_areas')
      .update({ is_active: false })
      .eq('id', area.id);

    if (error) throw error;

    try {
      await supabase.rpc('log_client_activity', {
        p_action_type: 'area_updated',
        p_description: `${profile.full_name} deactivated library area: ${area.name} (${recordCount || 0} records preserved)`,
        p_target_type: 'library_area',
        p_target_id: String(area.id),
      });
    } catch {
      // non-fatal
    }

    broadcastAreasChange();
    return {
      success: true,
      deactivated: true,
      message: `Library area "${area.name}" deactivated. All ${recordCount || 0} historical occupancy records have been safely preserved.`,
    };
  } else {
    // Hard delete
    const { error } = await supabase
      .from('library_areas')
      .delete()
      .eq('id', area.id);

    if (error) throw error;

    try {
      await supabase.rpc('log_client_activity', {
        p_action_type: 'area_updated',
        p_description: `${profile.full_name} deleted unused library area: ${area.name}`,
        p_target_type: 'library_area',
        p_target_id: String(area.id),
      });
    } catch {
      // non-fatal
    }

    broadcastAreasChange();
    return {
      success: true,
      deactivated: false,
      message: `Unused library area "${area.name}" deleted.`,
    };
  }
}

/**
 * Subscribe to realtime area updates.
 */
export function subscribeToAreaChanges(
  supabase: SupabaseClient,
  callback: () => void
): () => void {
  let channel: BroadcastChannel | null = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(AREAS_BROADCAST_CHANNEL);
      channel.onmessage = () => {
        callback();
      };
    } catch {
      // ignore
    }
  }

  const channelName = `lirc_library_areas_${Math.random().toString(36).substring(2, 9)}`;
  const sub = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'library_areas' },
      () => {
        callback();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(sub);
    channel?.close();
  };
}

/**
 * Return custom background photo for known library areas and duty stations.
 */
export function getAreaBackgroundImage(area: { code?: string; slug?: string; name: string }): string | null {
  const n = (area.name || '').toLowerCase();
  const c = (area.code || '').toUpperCase();
  const s = (area.slug || '').toLowerCase();

  // 1. Filipiniana
  if (c === 'FIL' || s === 'filipiniana' || n.includes('filipiniana')) {
    return '/filipiniana.jpg';
  }
  // 2. Circulation (Area & Duty Station)
  if (c === 'CIR' || s === 'circulation' || n.includes('circulation')) {
    return '/circulation.jpg';
  }
  // 3. Periodicals
  if (c === 'PER' || s === 'periodicals' || n.includes('periodical')) {
    return '/periodicals.jpg';
  }
  // 4. Learning Commons
  if (c === 'LC' || s === 'learning-commons' || n.includes('learning commons') || n.includes('commons')) {
    return encodeURI('/learning commons.jpg');
  }
  // 5. Discussion Rooms
  if (c === 'DR' || s === 'discussion-rooms' || n.includes('discussion')) {
    return encodeURI('/discussion rooms.jpg');
  }
  // 6. Reference
  if (c === 'REF' || s === 'reference' || n.includes('reference')) {
    return '/reference.jpg';
  }
  // 7. Shelver Duty Station
  if (c === 'SHL' || s === 'shelver' || n.includes('shelver') || n.includes('stack')) {
    return '/shelver.jpg';
  }
  // 8. Technical Duty Station
  if (c === 'TECH' || s === 'technical' || n.includes('technical') || n.includes('catalog')) {
    return '/technical.jpg';
  }
  // 9. Entrance / Exit Duty Station
  if (c === 'ENT' || s === 'entrance-exit' || n.includes('entrance') || n.includes('exit')) {
    return '/entrance.jpg';
  }
  // 10. Baggage Duty Station
  if (c === 'BAG' || s === 'baggage' || n.includes('baggage')) {
    return '/baggage.jpg';
  }
  // 11. General Reading Area
  if (n.includes('reading area')) {
    return encodeURI('/reading area.jpg');
  }

  return null;
}
