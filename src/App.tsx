import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import { LibraryArea, UserProfile } from './types/lirc';
import { LoginPage } from './components/LoginPage';
import { StudentAssistantPortal } from './components/StudentAssistantPortal';
import { LibrarianDashboard } from './components/LibrarianDashboard';
import { parseStaffAccount } from './utils/invitationWorkflow';

export const LOGGED_OUT_STORAGE_KEY = 'lirc_system_logged_out';

export const App: React.FC = () => {
  const [initializing, setInitializing] = useState<boolean>(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [areas, setAreas] = useState<LibraryArea[]>([]);
  const isSigningOutRef = useRef<boolean>(false);

  const loadAreas = useCallback(async () => {
    const { data } = await supabase
      .from('library_areas')
      .select('*')
      .order('display_order', { ascending: true });
    if (data && data.length > 0) {
      let foundReading = false;
      const mapped = (data as LibraryArea[]).map((area) => {
        if (
          area.code === 'READ' ||
          area.slug === 'reading-area' ||
          area.name.toLowerCase().includes('reading')
        ) {
          foundReading = true;
          return {
            ...area,
            name: 'Reading Area',
            code: 'READ',
            slug: 'reading-area',
            color_hex: area.color_hex || '#2E5A44',
          };
        }
        if (
          area.code === 'CIR' ||
          area.slug === 'circulation' ||
          area.name.toLowerCase().includes('circulation')
        ) {
          foundReading = true;
          return {
            ...area,
            name: 'Reading Area',
            code: 'READ',
            slug: 'reading-area',
            description: 'Main reading hall, general study tables, and student study areas.',
            capacity: area.capacity || 80,
            color_hex: '#2E5A44',
            icon_name: 'BookOpen',
          };
        }
        return area;
      });

      if (!foundReading) {
        mapped.splice(1, 0, {
          id: 9902,
          code: 'READ',
          slug: 'reading-area',
          name: 'Reading Area',
          description: 'Main reading hall, general study tables, and student study areas.',
          floor_location: '1st Floor, Main Hall',
          capacity: 80,
          color_hex: '#2E5A44',
          icon_name: 'BookOpen',
          display_order: 2,
          is_active: true,
        });
      }

      setAreas(mapped);
    }
  }, []);

  const syncLibraryAreasWithDatabase = useCallback(async () => {
    try {
      const { data: cirArea } = await supabase
        .from('library_areas')
        .select('id, name, code')
        .or('code.eq.CIR,slug.eq.circulation,name.eq.Circulation')
        .maybeSingle();

      if (cirArea) {
        await supabase
          .from('library_areas')
          .update({
            code: 'READ',
            slug: 'reading-area',
            name: 'Reading Area',
            description: 'Main reading hall, general study tables, and student study areas.',
            capacity: 80,
            color_hex: '#2E5A44',
            icon_name: 'BookOpen',
          })
          .eq('id', cirArea.id);
        await loadAreas();
      } else {
        const { data: readArea } = await supabase
          .from('library_areas')
          .select('id')
          .or('code.eq.READ,name.eq.Reading Area')
          .maybeSingle();

        if (!readArea) {
          await supabase.from('library_areas').insert({
            code: 'READ',
            slug: 'reading-area',
            name: 'Reading Area',
            description: 'Main reading hall, general study tables, and student study areas.',
            floor_location: '1st Floor, Main Hall',
            capacity: 80,
            color_hex: '#2E5A44',
            icon_name: 'BookOpen',
            display_order: 2,
            is_active: true,
          });
          await loadAreas();
        }
      }
    } catch (err) {
      console.warn('Sync library areas warning:', err);
    }
  }, [loadAreas]);

  const loadUserProfile = useCallback(
    async (userId: string) => {
      // If the user has logged out or is currently signing out, abort loading profile immediately
      if (isSigningOutRef.current || localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') {
        setProfile(null);
        setInitializing(false);
        return;
      }

      const [{ data: profileData }] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
        loadAreas(),
      ]);

      if (isSigningOutRef.current || localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') {
        setProfile(null);
        setInitializing(false);
        return;
      }

      if (profileData) {
        const rawProfile = profileData as UserProfile;
        const parsed = parseStaffAccount(rawProfile);
        if (
          rawProfile.is_active &&
          !parsed.isRemoved &&
          !parsed.isInviteCarrier &&
          parsed.approvalStatus === 'approved'
        ) {
          setProfile({
            ...rawProfile,
            staff_code: parsed.displayStaffCode,
          });
          if (rawProfile.role === 'librarian') {
            void syncLibraryAreasWithDatabase();
          }
        } else {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setInitializing(false);
    },
    [loadAreas]
  );

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      // If user explicitly signed out, never auto-sign-in on startup or reload
      if (localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') {
        if (!mounted) return;
        setProfile(null);
        setInitializing(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      if (
        session?.user &&
        !isSigningOutRef.current &&
        localStorage.getItem(LOGGED_OUT_STORAGE_KEY) !== 'true'
      ) {
        await loadUserProfile(session.user.id);
      } else {
        setProfile(null);
        setInitializing(false);
      }
    }

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (
        event === 'SIGNED_OUT' ||
        !session?.user ||
        isSigningOutRef.current ||
        localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true'
      ) {
        setProfile(null);
        setInitializing(false);
        return;
      }

      if (event === 'SIGNED_IN') {
        await loadUserProfile(session.user.id);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  const handleSignOut = async () => {
    // 1. Immediately flag signing out and persist logged out state
    isSigningOutRef.current = true;
    localStorage.setItem(LOGGED_OUT_STORAGE_KEY, 'true');
    setInitializing(true);

    try {
      if (profile) {
        // Close any active Student Assistant monitoring session cleanly & log sign-out
        try {
          if (profile.role === 'student_assistant') {
            await supabase.rpc('exit_monitoring_session', { p_session_id: null });
          }
        } catch {
          // ignore pre-cleanup error
        }

        try {
          await supabase.rpc('log_client_activity', {
            p_action_type: 'user_logout',
            p_description: `${profile.full_name} signed out of LIRC MANAGEMENT SYSTEM`,
            p_target_type: 'auth_session',
          });
        } catch {
          // ignore logging error
        }
      }
    } catch {
      // Proceed with sign-out even if pre-cleanup fails
    }

    // 2. Disconnect and remove all Supabase realtime channels
    try {
      await supabase.removeAllChannels();
    } catch {
      // ignore
    }

    // 3. Perform local and global Supabase sign out
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // ignore
    }
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch {
      // ignore
    }

    // 4. Force purge all Supabase session tokens, cached auth items, and station keys from storage
    try {
      if (typeof window !== 'undefined') {
        const purgeTokens = (storage: Storage) => {
          const keysToRemove: string[] = [];
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (
              k &&
              (k.startsWith('sb-') ||
                k.includes('auth-token') ||
                k.includes('supabase') ||
                k.startsWith('lirc_active_station_'))
            ) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach((k) => storage.removeItem(k));
        };

        purgeTokens(window.localStorage);
        purgeTokens(window.sessionStorage);
      }
    } catch {
      // ignore
    }

    // 5. Cleanly reset profile and finish initializing
    setProfile(null);
    setInitializing(false);
    isSigningOutRef.current = false;
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#F5EBDD] text-[#332F2B] flex flex-col items-center justify-center gap-3 relative overflow-hidden">
        {/* Real Library Photographic Background with Warm Academic Overlays */}
        <div
          className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none"
          style={{ backgroundImage: `url('/library-bg.jpg')` }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-[#F5EBDD]/88 backdrop-blur-[1.5px]" />
        </div>

        <div className="w-16 h-16 rounded-2xl bg-white border border-[#E6D7C3] flex items-center justify-center p-2 shadow-md relative z-10">
          <img src="/logo.png" alt="LIRC MANAGEMENT SYSTEM Logo" className="w-full h-full object-contain" />
        </div>
        <div className="flex items-center gap-2 text-sm text-[#332F2B] font-heading font-bold relative z-10">
          <RefreshCw className="w-4 h-4 animate-spin text-[#A83232]" />
          Opening LIRC MANAGEMENT SYSTEM Registry...
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <LoginPage
        onLoginSuccess={async () => {
          localStorage.removeItem(LOGGED_OUT_STORAGE_KEY);
          isSigningOutRef.current = false;
          setInitializing(true);
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            await loadUserProfile(session.user.id);
          } else {
            setInitializing(false);
          }
        }}
      />
    );
  }

  if (profile.role === 'librarian') {
    return (
      <LibrarianDashboard
        profile={profile}
        areas={areas}
        onSignOut={handleSignOut}
        onRefreshAreas={loadAreas}
      />
    );
  }

  return (
    <StudentAssistantPortal
      profile={profile}
      allAreas={areas}
      onSignOut={handleSignOut}
    />
  );
};

export default App;
