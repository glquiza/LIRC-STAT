/// <reference types="vite/client" />
import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import { LibraryArea, UserProfile } from './types/lirc';
import { LoginPage } from './components/LoginPage';
import { StudentAssistantPortal } from './components/StudentAssistantPortal';
import { LibrarianDashboard } from './components/LibrarianDashboard';
import { parseStaffAccount } from './utils/invitationWorkflow';

export const App: React.FC = () => {
  const [initializing, setInitializing] = useState<boolean>(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [areas, setAreas] = useState<LibraryArea[]>([]);

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
      const [{ data: profileData }] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
        loadAreas(),
      ]);

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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      if (session?.user) {
        await loadUserProfile(session.user.id);
      } else {
        setProfile(null);
        setInitializing(false);
      }
    }

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        loadUserProfile(session.user.id);
      } else {
        setProfile(null);
        setInitializing(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  const handleSignOut = async () => {
    setInitializing(true);
    try {
      if (profile) {
        // Close any active Student Assistant monitoring session cleanly & log sign-out
        await Promise.all([
          profile.role === 'student_assistant'
            ? supabase.rpc('exit_monitoring_session', { p_session_id: null })
            : Promise.resolve(),
          supabase.rpc('log_client_activity', {
            p_action_type: 'user_logout',
            p_description: `${profile.full_name} signed out of LIRC MANAGEMENT SYSTEM`,
            p_target_type: 'auth_session',
          }),
        ]);
      }
    } catch {
      // Proceed with sign-out even if logging fails
    }
    await supabase.auth.signOut();
    setProfile(null);
    setInitializing(false);
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
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            await loadUserProfile(session.user.id);
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
