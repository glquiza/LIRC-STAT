import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { supabase } from './lib/supabase';
import { LibraryArea, UserProfile } from './types/lirc';
import { LoginPage } from './components/LoginPage';
import { StudentAssistantPortal } from './components/StudentAssistantPortal';
import { LibrarianDashboard } from './components/LibrarianDashboard';
import { parseStaffAccount } from './utils/invitationWorkflow';

export const LOGGED_OUT_STORAGE_KEY = 'lirc_system_logged_out';
export const CACHED_PROFILE_KEY = 'lirc_cached_user_profile';
export const CACHED_AREAS_KEY = 'lirc_cached_library_areas';

export const DEFAULT_AREAS: LibraryArea[] = [
  {
    id: 9901,
    code: 'GEN',
    slug: 'general-reference',
    name: 'General Reference',
    description: 'General reference collection, encyclopedias, and reference consultation desks.',
    floor_location: '1st Floor, Reference Section',
    capacity: 60,
    color_hex: '#1E3A8A',
    icon_name: 'BookOpen',
    display_order: 1,
    is_active: true,
  },
  {
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
  },
  {
    id: 9903,
    code: 'PER',
    slug: 'periodicals',
    name: 'Periodicals Section',
    description: 'Journals, newspapers, magazines, serial publications, and newspaper archives.',
    floor_location: '1st Floor, East Wing',
    capacity: 40,
    color_hex: '#D97706',
    icon_name: 'Newspaper',
    display_order: 3,
    is_active: true,
  },
  {
    id: 9904,
    code: 'FIL',
    slug: 'filipiniana',
    name: 'Filipiniana Section',
    description: 'Filipiniana books, local historical monographs, and Philippine government documents.',
    floor_location: '2nd Floor, Main Wing',
    capacity: 50,
    color_hex: '#7C3AED',
    icon_name: 'Bookmark',
    display_order: 4,
    is_active: true,
  },
  {
    id: 9905,
    code: 'GRAD',
    slug: 'graduate-studies',
    name: 'Graduate Studies & Research',
    description: 'Quiet research carrels, thesis & dissertation repository, and postgraduate studies.',
    floor_location: '2nd Floor, West Wing',
    capacity: 30,
    color_hex: '#0D9488',
    icon_name: 'GraduationCap',
    display_order: 5,
    is_active: true,
  },
  {
    id: 9906,
    code: 'INTERNET',
    slug: 'internet-multimedia',
    name: 'Internet & Multimedia Lab',
    description: 'Computer workstations, online research, e-journals, OPAC terminals, and digital resources.',
    floor_location: '2nd Floor, Computer Lab',
    capacity: 45,
    color_hex: '#DC2626',
    icon_name: 'Monitor',
    display_order: 6,
    is_active: true,
  },
];

function getCachedProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') return null;
    const raw = localStorage.getItem(CACHED_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getCachedAreas(): LibraryArea[] {
  if (typeof window === 'undefined') return DEFAULT_AREAS;
  try {
    const raw = localStorage.getItem(CACHED_AREAS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_AREAS;
  } catch {
    return DEFAULT_AREAS;
  }
}

/**
 * Executes a promise with a maximum timeout to prevent slow network hanging.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs = 2500, fallbackValue: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export const App: React.FC = () => {
  const cachedInitialProfile = useRef<UserProfile | null>(getCachedProfile());
  const cachedInitialAreas = useRef<LibraryArea[]>(getCachedAreas());

  // Determine if we should start initializing
  const isExplicitlyLoggedOut =
    typeof window !== 'undefined' && localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true';

  const hasStoredTokens =
    typeof window !== 'undefined' &&
    Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('auth-token'));

  // If user has a cached profile or is explicitly logged out, initializing is FALSE right away (0ms startup!)
  const initialInitializing =
    !isExplicitlyLoggedOut && !cachedInitialProfile.current && hasStoredTokens;

  const [initializing, setInitializing] = useState<boolean>(initialInitializing);
  const [profile, setProfile] = useState<UserProfile | null>(cachedInitialProfile.current);
  const [areas, setAreas] = useState<LibraryArea[]>(cachedInitialAreas.current);
  const isSigningOutRef = useRef<boolean>(false);

  const loadAreas = useCallback(async () => {
    try {
      const { data } = await withTimeout(
        supabase
          .from('library_areas')
          .select('*')
          .order('display_order', { ascending: true }),
        3000,
        { data: null }
      );

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
        try {
          localStorage.setItem(CACHED_AREAS_KEY, JSON.stringify(mapped));
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('[App] Load areas warning:', err);
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
        void loadAreas();
      }
    } catch (err) {
      console.warn('[App] Sync library areas warning:', err);
    }
  }, [loadAreas]);

  const loadUserProfile = useCallback(
    async (userId: string) => {
      if (isSigningOutRef.current || localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') {
        setProfile(null);
        setInitializing(false);
        return;
      }

      try {
        const { data: profileData } = await withTimeout(
          supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
          2500,
          { data: null }
        );

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
            const formattedProfile: UserProfile = {
              ...rawProfile,
              staff_code: parsed.displayStaffCode,
            };
            setProfile(formattedProfile);
            try {
              localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(formattedProfile));
            } catch {
              // ignore
            }

            if (rawProfile.role === 'librarian') {
              void syncLibraryAreasWithDatabase();
            }
          } else {
            setProfile(null);
            localStorage.removeItem(CACHED_PROFILE_KEY);
          }
        } else {
          // If network timed out but we already have a cached profile, keep the cached profile!
          if (!cachedInitialProfile.current) {
            setProfile(null);
          }
        }
      } catch (err) {
        console.warn('[App] loadUserProfile error:', err);
      } finally {
        setInitializing(false);
      }
    },
    [syncLibraryAreasWithDatabase]
  );

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      // 1. If user explicitly signed out, show login page immediately
      if (localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === 'true') {
        if (!mounted) return;
        setProfile(null);
        setInitializing(false);
        return;
      }

      // 2. Fetch session with 2000ms timeout protection
      try {
        const sessionRes = await withTimeout(
          supabase.auth.getSession(),
          2000,
          { data: { session: null } }
        );

        if (!mounted) return;

        const session = sessionRes.data?.session;

        if (
          session?.user &&
          !isSigningOutRef.current &&
          localStorage.getItem(LOGGED_OUT_STORAGE_KEY) !== 'true'
        ) {
          await loadUserProfile(session.user.id);
        } else {
          if (!cachedInitialProfile.current) {
            setProfile(null);
          }
          setInitializing(false);
        }
      } catch (err) {
        console.warn('[App] Session check error:', err);
        if (mounted) {
          setInitializing(false);
        }
      }
    }

    initSession();

    // Background load areas without blocking
    void loadAreas();

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
        localStorage.removeItem(CACHED_PROFILE_KEY);
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
  }, [loadAreas, loadUserProfile]);

  const handleSignOut = async () => {
    isSigningOutRef.current = true;
    localStorage.setItem(LOGGED_OUT_STORAGE_KEY, 'true');
    localStorage.removeItem(CACHED_PROFILE_KEY);
    setProfile(null);
    setInitializing(false);

    try {
      if (profile) {
        try {
          if (profile.role === 'student_assistant') {
            await supabase.rpc('exit_monitoring_session', { p_session_id: null });
          }
        } catch {
          // ignore
        }

        try {
          await supabase.rpc('log_client_activity', {
            p_action_type: 'user_logout',
            p_description: `${profile.full_name} signed out of LIRC MANAGEMENT SYSTEM`,
            p_target_type: 'auth_session',
          });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    try {
      await supabase.removeAllChannels();
    } catch {
      // ignore
    }

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // ignore
    }

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
                k.startsWith('lirc_active_station_') ||
                k === CACHED_PROFILE_KEY)
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

    isSigningOutRef.current = false;
  };

  // If initializing, display graceful quick-loader with an instant bypass button
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

        <div className="w-16 h-16 rounded-2xl bg-white border border-[#E6D7C3] flex items-center justify-center p-2 shadow-md relative z-10 animate-fade-in">
          <img src="/logo.png" alt="LIRC MANAGEMENT SYSTEM Logo" className="w-full h-full object-contain" />
        </div>
        <div className="flex items-center gap-2 text-sm text-[#332F2B] font-heading font-bold relative z-10">
          <RefreshCw className="w-4 h-4 animate-spin text-[#A83232]" />
          <span>Opening LIRC MANAGEMENT SYSTEM Registry...</span>
        </div>

        {/* Instant Skip to Login button in case of slow internet connection */}
        <button
          type="button"
          onClick={() => {
            setInitializing(false);
            setProfile(null);
          }}
          className="mt-2 relative z-10 px-3.5 py-1.5 rounded-xl bg-white/90 hover:bg-white border border-[#E6D7C3] text-xs font-semibold text-stone-700 hover:text-[#A83232] shadow-sm transition flex items-center gap-1.5 cursor-pointer"
        >
          <span>Continue to Sign In</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <LoginPage
        onLoginSuccess={(loggedProfile) => {
          localStorage.removeItem(LOGGED_OUT_STORAGE_KEY);
          isSigningOutRef.current = false;
          if (loggedProfile) {
            try {
              localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(loggedProfile));
            } catch {
              // ignore
            }
            setProfile(loggedProfile);
            setInitializing(false);
            void loadAreas();
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
