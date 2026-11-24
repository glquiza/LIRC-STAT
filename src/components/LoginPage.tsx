import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LogIn,
  Radio,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoginDirectoryItem, ServerClock, UserProfile } from '../types/lirc';
import {
  encodeRegistrationStaffCode,
  parseInviteCodeCarrier,
  parseStaffAccount,
} from '../utils/invitationWorkflow';
import { gsapFadeIn, gsapPopIn, gsap } from '../utils/animations';
import { AnimatedBookLogo } from './AnimatedBookLogo';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  // Modal state: null = viewing landing page, 'signin' | 'signup' = modal dialog active
  const [activeAuthModal, setActiveAuthModal] = useState<'signin' | 'signup' | null>(null);

  // Sign In state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // Student Assistant Sign Up — Personal Details state
  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [courseDepartment, setCourseDepartment] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Submit Invitation Code Modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitationCodeInput, setInvitationCodeInput] = useState('');
  const [inviteModalError, setInviteModalError] = useState<string | null>(null);
  const [submittingRegistration, setSubmittingRegistration] = useState(false);

  // Completed registration confirmation state
  const [submittedRequestSummary, setSubmittedRequestSummary] = useState<{
    fullName: string;
    username: string;
    studentId: string;
    courseDepartment: string;
    inviteCode: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingNoticeMsg, setPendingNoticeMsg] = useState<string | null>(null);
  const [serverClock, setServerClock] = useState<ServerClock | null>(null);

  // PWA App Installation state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [activeInstallTab, setActiveInstallTab] = useState<'windows' | 'android' | 'ios'>('windows');

  const modalRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const inviteModalRef = useRef<HTMLDivElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);

  // Hero Action Buttons GSAP Refs & Interactions
  const createBtnRef = useRef<HTMLButtonElement | null>(null);
  const signInBtnRef = useRef<HTMLButtonElement | null>(null);
  const installBtnRef = useRef<HTMLButtonElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);

  const loadClock = async () => {
    const { data, error } = await supabase.rpc('get_server_clock');
    if (!error && data) {
      setServerClock(data as ServerClock);
    }
  };

  useEffect(() => {
    loadClock();

    // Check if running in standalone window (PWA already installed)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setIsAppInstalled(true);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
      setShowInstallModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallAppClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          setIsAppInstalled(true);
        }
        setDeferredPrompt(null);
      } catch {
        setShowInstallModal(true);
      }
    } else {
      setShowInstallModal(true);
    }
  };

  // GSAP Entrance animation for hero buttons
  useEffect(() => {
    if (createBtnRef.current && signInBtnRef.current) {
      gsap.fromTo(
        [createBtnRef.current, signInBtnRef.current],
        { opacity: 0, y: 18, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          stagger: 0.12,
          ease: 'power3.out',
          delay: 0.2,
        }
      );
    }
  }, []);

  // Simple, smooth GSAP hover interactions (no spring elevation, no heavy shadows)
  const handleCreateBtnEnter = () => {
    if (!createBtnRef.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    gsap.to(createBtnRef.current, {
      backgroundColor: isDark ? '#2D2823' : '#1A1816',
      duration: 0.2,
      ease: 'power1.out',
    });
    if (arrowRef.current) {
      gsap.to(arrowRef.current, { x: 3, duration: 0.2, ease: 'power1.out' });
    }
  };

  const handleCreateBtnLeave = () => {
    if (!createBtnRef.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    gsap.to(createBtnRef.current, {
      backgroundColor: isDark ? '#1E1B18' : '#2D2926',
      duration: 0.2,
      ease: 'power1.out',
    });
    if (arrowRef.current) {
      gsap.to(arrowRef.current, { x: 0, duration: 0.2, ease: 'power1.out' });
    }
  };

  const handleCreateBtnDown = () => {
    if (!createBtnRef.current) return;
    gsap.to(createBtnRef.current, { scale: 0.98, duration: 0.1, ease: 'power1.out' });
  };

  const handleCreateBtnUp = () => {
    if (!createBtnRef.current) return;
    gsap.to(createBtnRef.current, { scale: 1, duration: 0.15, ease: 'power1.out' });
  };

  const handleSignInBtnEnter = () => {
    if (!signInBtnRef.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    gsap.to(signInBtnRef.current, {
      backgroundColor: isDark ? '#2D2620' : '#FAF5EE',
      borderColor: isDark ? '#5C4E40' : '#B8A48B',
      duration: 0.2,
      ease: 'power1.out',
    });
  };

  const handleSignInBtnLeave = () => {
    if (!signInBtnRef.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    gsap.to(signInBtnRef.current, {
      backgroundColor: isDark ? '#241F1A' : '#FFFFFF',
      borderColor: isDark ? '#3D342C' : '#D6C3A9',
      duration: 0.2,
      ease: 'power1.out',
    });
  };

  const handleSignInBtnDown = () => {
    if (!signInBtnRef.current) return;
    gsap.to(signInBtnRef.current, { scale: 0.98, duration: 0.1, ease: 'power1.out' });
  };

  const handleSignInBtnUp = () => {
    if (!signInBtnRef.current) return;
    gsap.to(signInBtnRef.current, { scale: 1, duration: 0.15, ease: 'power1.out' });
  };

  useEffect(() => {
    if (activeAuthModal && modalRef.current) {
      gsapFadeIn(modalRef.current, { y: 20, duration: 0.45, ease: 'power3.out' });
    }
  }, [activeAuthModal]);

  useEffect(() => {
    if (formRef.current) {
      gsap.fromTo(
        formRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
      );
    }
  }, [activeAuthModal]);

  useEffect(() => {
    if (showInviteModal && inviteModalRef.current) {
      gsapPopIn(inviteModalRef.current);
    }
  }, [showInviteModal]);

  useEffect(() => {
    if (submittedRequestSummary && successRef.current) {
      gsapPopIn(successRef.current);
    }
  }, [submittedRequestSummary]);

  const openAuthModal = (tab: 'signin' | 'signup') => {
    setErrorMsg(null);
    setPendingNoticeMsg(null);
    setActiveAuthModal(tab);
  };

  const closeAuthModal = () => {
    setActiveAuthModal(null);
    setErrorMsg(null);
    setPendingNoticeMsg(null);
  };

  const performLogin = async (usernameInput: string, pass: string) => {
    setErrorMsg(null);
    setPendingNoticeMsg(null);
    setLoading(true);
    try {
      const cleanInput = usernameInput.trim();
      if (!cleanInput || !pass) {
        throw new Error('Please enter your email or username and password.');
      }

      let targetEmail = cleanInput;
      if (!cleanInput.includes('@')) {
        const { data: resolvedEmail, error: rpcError } = await supabase.rpc('resolve_login_email', {
          p_identifier: cleanInput,
        });
        if (!rpcError && resolvedEmail) {
          targetEmail = resolvedEmail as string;
        } else {
          targetEmail = `${cleanInput.toLowerCase()}@lirc.edu.ph`;
        }
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: pass,
      });

      if (signInError || !signInData.user) {
        throw new Error('Invalid email, username, or password.');
      }

      // Check user profile approval status
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', signInData.user.id)
        .maybeSingle();

      if (!profileData) {
        await supabase.auth.signOut();
        throw new Error('User profile not found.');
      }

      const parsed = parseStaffAccount(profileData as UserProfile);

      if (parsed.isInviteCarrier || parsed.isRemoved) {
        await supabase.auth.signOut();
        throw new Error('This account is no longer active.');
      }

      if (parsed.approvalStatus === 'pending') {
        await supabase.auth.signOut();
        setPendingNoticeMsg(
          `Your Student Assistant registration (@${parsed.profile.username}) submitted with invitation code ${
            parsed.inviteCode || 'N/A'
          } is currently pending review and approval by the Librarian.`
        );
        return;
      }

      if (parsed.approvalStatus === 'rejected') {
        await supabase.auth.signOut();
        throw new Error(
          'Your Student Assistant registration request was declined by the Librarian.'
        );
      }

      if (!parsed.profile.is_active) {
        await supabase.auth.signOut();
        throw new Error('Your account is currently inactive. Please contact the Librarian.');
      }

      await supabase.rpc('log_client_activity', {
        p_action_type: 'user_login',
        p_description: `Signed in to LIRC STAT (${cleanInput})`,
        p_target_type: 'auth_session',
        p_metadata: { identifier: cleanInput },
      });

      onLoginSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(identifier, password);
  };

  // Step 1: Validate Personal Details Form and open "Submit Invitation Code" Modal
  const handleProceedToInvitationCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setPendingNoticeMsg(null);

    const cleanName = fullName.trim();
    const cleanId = studentId.trim();
    const cleanCourse = courseDepartment.trim();
    const cleanUser = newUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');

    if (!cleanName || !cleanId || !cleanCourse || !cleanUser || !newPassword) {
      setErrorMsg('Please complete all required personal details.');
      return;
    }

    if (cleanUser.length < 3) {
      setErrorMsg('Username must be at least 3 characters (letters, numbers, underscores).');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password.');
      return;
    }

    setInviteModalError(null);
    setShowInviteModal(true);
  };

  // Step 2: Verify Invitation Code & Submit Registration Request for Librarian Approval
  const handleConfirmInvitationCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteModalError(null);

    const normalizedCode = invitationCodeInput.trim().toUpperCase();
    if (!normalizedCode) {
      setInviteModalError('Please enter the invitation code provided by the Librarian.');
      return;
    }

    setSubmittingRegistration(true);
    try {
      // 1. Fetch active invitation codes generated by the Librarian
      const { data: dirData, error: dirError } = await supabase.rpc('get_login_directory');
      if (dirError) {
        throw new Error('Could not verify invitation code right now. Please try again.');
      }

      const rows = Array.isArray(dirData) ? (dirData as LoginDirectoryItem[]) : [];
      const activeCodes = rows
        .map((r) =>
          parseInviteCodeCarrier({
            id: r.id,
            full_name: r.full_name,
            staff_code: r.staff_code,
            shift_schedule: r.shift_schedule,
            is_active: true,
          })
        )
        .filter((item): item is NonNullable<typeof item> => item !== null && item.isActive);

      const matchedInvite = activeCodes.find((c) => c.code === normalizedCode);
      if (!matchedInvite) {
        throw new Error(
          `Invitation code "${normalizedCode}" is invalid or has expired. Please obtain a valid invitation code from the Librarian.`
        );
      }

      // 2. Encode registration request as PENDING for Librarian review
      const cleanName = fullName.trim();
      const cleanId = studentId.trim();
      const cleanCourse = courseDepartment.trim();
      const cleanUser = newUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      const generatedEmail = `${cleanUser}@lirc.edu.ph`;

      const encodedPendingStaffCode = encodeRegistrationStaffCode({
        status: 'pending',
        studentId: cleanId,
        inviteCode: normalizedCode,
        courseDepartment: cleanCourse,
      });

      const { error: regError } = await supabase.rpc('register_staff_account', {
        p_email: generatedEmail,
        p_username: cleanUser,
        p_password: newPassword,
        p_full_name: cleanName,
        p_staff_code: encodedPendingStaffCode,
        p_role: 'student_assistant',
      });

      if (regError) {
        if (
          regError.message?.includes('register_staff_account') ||
          regError.code === 'PGRST202'
        ) {
          throw new Error(
            'The database registration function is missing in Supabase. Please run the migration script "supabase/migrations/20261123000001_register_staff_account.sql" in your Supabase SQL Editor.'
          );
        }
        throw new Error(regError.message);
      }

      // 3. Close modal and display Pending Librarian Approval confirmation
      setShowInviteModal(false);
      setSubmittedRequestSummary({
        fullName: cleanName,
        username: cleanUser,
        studentId: cleanId,
        courseDepartment: cleanCourse,
        inviteCode: normalizedCode,
      });

      // Reset form inputs
      setFullName('');
      setStudentId('');
      setCourseDepartment('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      setInvitationCodeInput('');
    } catch (err: unknown) {
      setInviteModalError(
        err instanceof Error ? err.message : 'Unable to submit registration request.'
      );
    } finally {
      setSubmittingRegistration(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5EBDD] text-[#332F2B] flex flex-col relative overflow-hidden">
      {/* Real Library Photographic Background with Warm Academic Overlays */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none"
        style={{ backgroundImage: `url('/library-bg.jpg')` }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[#F5EBDD]/92 dark:bg-[#161311]/95 backdrop-blur-[3px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#F5EBDD]/25 to-[#EDE0CE]/75 dark:via-[#161311]/25 dark:to-[#0D0B0A]/80 pointer-events-none" />
      </div>



      {/* =====================================================================
          LANDING HERO & FEATURE CARDS (MAIN VIEW)
      ===================================================================== */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-20 flex flex-col justify-center items-center relative z-10">
        {/* Transparent & Expanded Animated Hero Logo */}
        <div className="flex justify-center mb-5 sm:mb-7 animate-literary-fade">
          <AnimatedBookLogo className="h-16 sm:h-24 md:h-28 w-auto" />
        </div>

        {/* Institution Badge Pill */}
        <div className="mb-3 sm:mb-4 text-center max-w-[95vw]">
          <span className="inline-flex items-center px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-[#FFFFFF]/95 dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#3D342C] text-[9.5px] sm:text-[11px] font-semibold text-[#8C6514] dark:text-[#E7B84B] tracking-[0.08em] sm:tracking-[0.16em] uppercase shadow-2xs text-center">
            LEARNING &amp; INFORMATION RESOURCE CENTER
          </span>
        </div>

        {/* Grand Title: Large with cohesive letter kerning */}
        <h1 className="text-4xl xs:text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-[5.5rem] font-heading font-black text-[#2B2621] dark:text-[#F5EFE6] tracking-[0.04em] sm:tracking-[0.08em] md:tracking-[0.10em] lg:tracking-[0.12em] uppercase text-center mb-3 sm:mb-4 leading-none select-none max-w-full break-words">
          LIRC STAT
        </h1>

        {/* Subtitle / Platform Mission: Constrained narrower than the grand title */}
        <p className="text-xs sm:text-sm md:text-base text-[#665D53] dark:text-[#A89C8F] max-w-xs sm:max-w-lg md:max-w-xl mx-auto text-center leading-relaxed font-normal mb-6 sm:mb-10 px-2">
          An Integrated Academic Platform for Library Occupancy Monitoring, Real-Time Statistical Reporting, and Duty Scheduling
        </p>

        {/* Action Buttons: Create Account, Sign In & Install App */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full max-w-xs sm:max-w-none mb-10 sm:mb-18">
          <button
            ref={createBtnRef}
            type="button"
            onClick={() => openAuthModal('signup')}
            onMouseEnter={handleCreateBtnEnter}
            onMouseLeave={handleCreateBtnLeave}
            onMouseDown={handleCreateBtnDown}
            onMouseUp={handleCreateBtnUp}
            className="h-11 sm:h-12 px-6 sm:px-7 rounded-2xl bg-[#2D2926] dark:bg-[#1E1B18] text-white font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer select-none shadow-sm hover:bg-[#1E1B18] w-full sm:w-auto"
          >
            <span>Create Account</span>
            <ArrowRight ref={arrowRef} className="w-4 h-4 transition-transform" />
          </button>

          <button
            ref={signInBtnRef}
            type="button"
            onClick={() => openAuthModal('signin')}
            onMouseEnter={handleSignInBtnEnter}
            onMouseLeave={handleSignInBtnLeave}
            onMouseDown={handleSignInBtnDown}
            onMouseUp={handleSignInBtnUp}
            className="h-11 sm:h-12 px-6 sm:px-7 rounded-2xl bg-white dark:bg-[#241F1A] border border-[#D6C3A9] dark:border-[#3D342C] text-[#332F2B] dark:text-[#FAF5EE] font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer select-none hover:bg-[#FAF5EE] dark:hover:bg-[#2D2721] w-full sm:w-auto"
          >
            <span>Sign In</span>
          </button>

          {!isAppInstalled && (
            <button
              ref={installBtnRef}
              type="button"
              onClick={handleInstallAppClick}
              className="h-11 sm:h-12 px-5 sm:px-6 rounded-2xl bg-[#FEF9EC] dark:bg-[#2A241E] border border-[#E7B84B] dark:border-[#B58D3D] text-[#7D5B06] dark:text-[#F3D085] hover:bg-[#F5EBDD] dark:hover:bg-[#342D25] font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none shadow-2xs hover:shadow-xs w-full sm:w-auto"
              title="Install LIRC STAT as Desktop or Mobile Application"
            >
              <Download className="w-4 h-4 text-[#A83232] dark:text-[#E7B84B]" />
              <span>Install App</span>
            </button>
          )}
        </div>

        {/* 4 Feature Descriptions of What the System Does */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-12">
          {/* Card 1: Live Occupancy & Station Tracking */}
          <div className="bg-[#FFFFFF]/95 backdrop-blur-md rounded-3xl p-6 sm:p-7 border border-[#E6D7C3] shadow-md hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col justify-between group">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#5C1111] via-[#8E2828] to-[#6E4204] absolute top-0 left-0 transition-all duration-300 group-hover:h-2" />
            <div>
              <div className="w-11 h-11 rounded-2xl bg-[#2D2926] text-[#FAF5EE] flex items-center justify-center mb-5 shadow-sm">
                <Radio className="w-5 h-5 text-[#E7B84B]" />
              </div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] mb-2 leading-snug">
                Live Occupancy &amp; Station Tracking
              </h2>
              <p className="text-xs text-[#6E665E] leading-relaxed">
                Submit synchronized 30-minute interval student headcounts across statistical areas, with active "Enter Area" station monitoring for all zones (including Baggage Counter) and live presence indicators.
              </p>
            </div>
          </div>

          {/* Card 2: Duty Schedules & Shift Rotations */}
          <div className="bg-[#FFFFFF]/95 backdrop-blur-md rounded-3xl p-6 sm:p-7 border border-[#E6D7C3] shadow-md hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col justify-between group">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#5C1111] via-[#8E2828] to-[#6E4204] absolute top-0 left-0 transition-all duration-300 group-hover:h-2" />
            <div>
              <div className="w-11 h-11 rounded-2xl bg-[#2D2926] text-[#FAF5EE] flex items-center justify-center mb-5 shadow-sm">
                <CalendarClock className="w-5 h-5 text-[#E7B84B]" />
              </div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] mb-2 leading-snug">
                Duty Schedules &amp; Shift Rotations
              </h2>
              <p className="text-xs text-[#6E665E] leading-relaxed">
                Manage MWF, TTH, and Saturday rotations with combined multi-hour shifts, multi-assistant area assignments, and real-time dual display of Current and Next duty assignments with automated shift notifications.
              </p>
            </div>
          </div>

          {/* Card 3: Statistical Ledgers & Multi-Format Exports */}
          <div className="bg-[#FFFFFF]/95 backdrop-blur-md rounded-3xl p-6 sm:p-7 border border-[#E6D7C3] shadow-md hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col justify-between group">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#5C1111] via-[#8E2828] to-[#6E4204] absolute top-0 left-0 transition-all duration-300 group-hover:h-2" />
            <div>
              <div className="w-11 h-11 rounded-2xl bg-[#2D2926] text-[#FAF5EE] flex items-center justify-center mb-5 shadow-sm">
                <TrendingUp className="w-5 h-5 text-[#E7B84B]" />
              </div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] mb-2 leading-snug">
                Statistical Ledgers &amp; Exports
              </h2>
              <p className="text-xs text-[#6E665E] leading-relaxed">
                Generate official daily, monthly, and custom date-range occupancy reports with peak hour detection, capacity comparisons, and instant one-click exports to Excel (.xlsx), PDF, and Word (.docx).
              </p>
            </div>
          </div>

          {/* Card 4: Academic Calendar & Administration */}
          <div className="bg-[#FFFFFF]/95 backdrop-blur-md rounded-3xl p-6 sm:p-7 border border-[#E6D7C3] shadow-md hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col justify-between group">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#5C1111] via-[#8E2828] to-[#6E4204] absolute top-0 left-0 transition-all duration-300 group-hover:h-2" />
            <div>
              <div className="w-11 h-11 rounded-2xl bg-[#2D2926] text-[#FAF5EE] flex items-center justify-center mb-5 shadow-sm">
                <ShieldCheck className="w-5 h-5 text-[#E7B84B]" />
              </div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] mb-2 leading-snug">
                Academic Calendar &amp; Administration
              </h2>
              <p className="text-xs text-[#6E665E] leading-relaxed">
                Real-time synchronized Calendar of Activities with automated class suspension exclusion from audits, secure invitation code onboarding, and Librarian supervisory approval.
              </p>
            </div>
          </div>
        </div>

        {/* System Motto / Assurance Tag */}
        <div className="flex items-center justify-center gap-2 text-xs text-[#6E665E] bg-white/60 px-4 py-2 rounded-full border border-[#E6D7C3]/80 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-[#A83232]" />
          <span>LIRC STAT System — Crafted for academic precision, accuracy, and order</span>
        </div>
      </main>

      {/* =====================================================================
          AUTHENTICATION MODAL DIALOG (SIGN IN & CREATE ACCOUNT)
      ===================================================================== */}
      {activeAuthModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeAuthModal();
            }
          }}
          className="fixed inset-0 z-50 bg-[#332F2B]/60 backdrop-blur-xs overflow-y-auto p-3 sm:p-6 flex flex-col items-center justify-start sm:justify-center min-h-screen"
        >
          <div
            ref={modalRef}
            className="max-w-[460px] w-full rounded-2xl sm:rounded-3xl p-4 sm:p-7 bg-[#FFFFFF] shadow-2xl border border-[#E6D7C3] relative overflow-hidden my-auto shrink-0 max-h-[92vh] overflow-y-auto"
          >
            {/* Top Academic Accent Gradient Stripe */}
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0 z-10" />

            {/* Top Right Close button */}
            <button
              type="button"
              onClick={closeAuthModal}
              title="Close modal"
              aria-label="Close modal"
              className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 z-20 w-8 h-8 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE] hover:bg-[#F5EBDD] hover:border-[#D6C3A9] flex items-center justify-center text-[#6E665E] hover:text-[#332F2B] transition-colors cursor-pointer shadow-2xs"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Static Modal Logo */}
            <div className="flex justify-center mb-3 sm:mb-4">
              <img
                src="/logo.png"
                alt="LIRC STAT Logo"
                className="h-12 sm:h-14 w-auto object-contain select-none"
              />
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-2xl bg-[#FDF3F3] border border-[#A83232]/30 text-[#A83232] text-xs font-medium">
                {errorMsg}
              </div>
            )}

            {pendingNoticeMsg && (
              <div className="mb-4 p-3.5 rounded-2xl bg-[#FEF9EC] border border-[#E7B84B] text-[#7D5B06] text-xs font-medium leading-relaxed">
                <div className="font-bold text-[#332F2B] mb-0.5">
                  Registration Pending Approval
                </div>
                {pendingNoticeMsg}
              </div>
            )}

            <div ref={formRef}>
              {activeAuthModal === 'signin' ? (
                /* ==================== SIGN IN VIEW ==================== */
                <>
                  <div className="text-center mb-6">
                    <h2 className="text-2xl sm:text-3xl font-heading font-bold text-[#332F2B] tracking-tight">
                      Welcome Back
                    </h2>
                    <p className="text-xs sm:text-[13px] text-[#6E665E] mt-2 leading-relaxed max-w-xs mx-auto">
                      Sign in to access library occupancy analytics, duty schedules, and live monitoring.
                    </p>
                  </div>

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-[#6E665E] tracking-wider uppercase mb-1.5">
                        EMAIL ADDRESS OR USERNAME
                      </label>
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="you@example.com or username"
                        className="w-full h-12 px-4 rounded-2xl bg-[#FAF6F0]/60 border border-[#E6D7C3] text-[#332F2B] placeholder-[#6E665E]/50 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                        required
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-[#6E665E] tracking-wider uppercase">
                          PASSWORD
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowForgotPassword(true)}
                          className="text-xs font-semibold text-[#8E2828] hover:text-[#A83232] hover:underline cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full h-12 pl-4 pr-11 rounded-2xl bg-[#FAF6F0]/60 border border-[#E6D7C3] text-[#332F2B] placeholder-[#6E665E]/50 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition tracking-wide"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-[#6E665E] hover:text-[#332F2B] cursor-pointer transition rounded-lg"
                          title={showPassword ? 'Hide password' : 'Show password'}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-12 rounded-2xl bg-[#2D2926] hover:bg-[#1E1B18] active:scale-[0.99] text-white font-semibold text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer mt-2"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                    </button>
                  </form>

                  <div className="mt-6 text-center text-xs text-[#6E665E]">
                    Don't have an account yet?{' '}
                    <button
                      type="button"
                      onClick={() => openAuthModal('signup')}
                      className="font-bold text-[#332F2B] underline hover:text-[#A83232] cursor-pointer ml-1"
                    >
                      Create an account
                    </button>
                  </div>
                </>
              ) : submittedRequestSummary ? (
                /* ==================== POST-SUBMISSION VIEW ==================== */
                <div ref={successRef} className="space-y-4">
                  <div className="p-4 rounded-2xl bg-[#F1F5EE] border border-[#C5D3B8] flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#71865A] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-base font-heading font-bold text-[#332F2B]">
                        Registration Request Submitted
                      </h3>
                      <p className="text-xs text-[#455436] mt-1 leading-relaxed">
                        Your Student Assistant registration and invitation code have been sent to the Librarian for review.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#FAF5EE] border border-[#E6D7C3] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Approval Status</span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                        Pending Librarian Approval
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Full Name</span>
                      <span className="font-semibold text-[#332F2B]">
                        {submittedRequestSummary.fullName}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Username</span>
                      <span className="font-mono font-semibold text-[#A83232]">
                        @{submittedRequestSummary.username}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Student / Staff ID</span>
                      <span className="font-stat font-semibold text-[#332F2B]">
                        {submittedRequestSummary.studentId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Course / Department</span>
                      <span className="font-semibold text-[#332F2B]">
                        {submittedRequestSummary.courseDepartment}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6E665E]">Invitation Code Used</span>
                      <span className="font-mono font-bold text-[#332F2B] bg-white px-2 py-0.5 rounded border border-[#D6C3A9]">
                        {submittedRequestSummary.inviteCode}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSubmittedRequestSummary(null);
                      setActiveAuthModal('signin');
                    }}
                    className="w-full h-12 rounded-2xl bg-[#2D2926] hover:bg-[#1E1B18] text-white font-semibold text-xs transition cursor-pointer"
                  >
                    Return to Sign In
                  </button>
                </div>
              ) : (
                /* ==================== CREATE ACCOUNT VIEW ==================== */
                <>
                  <div className="text-center mb-4">
                    <h2 className="text-2xl sm:text-[26px] font-heading font-bold text-[#332F2B] tracking-tight">
                      Create an Account
                    </h2>
                    <p className="text-xs sm:text-[13px] text-[#6E665E] mt-1 leading-relaxed max-w-xs mx-auto">
                      Register as a Student Assistant with your Librarian invitation code.
                    </p>
                  </div>

                  <form onSubmit={handleProceedToInvitationCode} className="space-y-3">
                    <div>
                      <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                        FULL NAME
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Clara Ibarra"
                        className="w-full h-10.5 px-3.5 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                          STUDENT / STAFF ID
                        </label>
                        <input
                          type="text"
                          required
                          value={studentId}
                          onChange={(e) => setStudentId(e.target.value)}
                          placeholder="e.g. SA-2026-108"
                          className="w-full h-10.5 px-3 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm font-stat focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                          USERNAME
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. sa_clara"
                          className="w-full h-10.5 px-3 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                        COURSE / DEPARTMENT
                      </label>
                      <input
                        type="text"
                        required
                        value={courseDepartment}
                        onChange={(e) => setCourseDepartment(e.target.value)}
                        placeholder="e.g. BS Information Technology - 3rd Year"
                        className="w-full h-10.5 px-3.5 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                          PASSWORD
                        </label>
                        <div className="relative">
                          <input
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Min. 6 chars"
                            className="w-full h-10.5 pl-3 pr-8 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword((prev) => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#6E665E] hover:text-[#332F2B] cursor-pointer transition rounded"
                            title={showNewPassword ? 'Hide password' : 'Show password'}
                            aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                          >
                            {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-bold text-[#6E665E] tracking-wider uppercase mb-1">
                          CONFIRM
                        </label>
                        <div className="relative">
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Re-enter password"
                            className="w-full h-10.5 pl-3 pr-8 rounded-xl bg-[#FAF6F0]/60 border border-[#D6C3A9] text-[#332F2B] text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword((prev) => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#6E665E] hover:text-[#332F2B] cursor-pointer transition rounded"
                            title={showConfirmPassword ? 'Hide password' : 'Show password'}
                            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                          >
                            {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full h-11 sm:h-11.5 rounded-xl bg-[#2D2926] hover:bg-[#1E1B18] active:scale-[0.99] text-white font-semibold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer mt-2 shadow-xs"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>Continue to Invitation Code</span>
                    </button>
                  </form>

                  <div className="mt-3.5 text-center text-xs text-[#6E665E]">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => openAuthModal('signin')}
                      className="font-bold text-[#332F2B] underline hover:text-[#A83232] cursor-pointer ml-1"
                    >
                      Sign in
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 p-3 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] flex items-start gap-2.5 text-xs text-[#6E665E]">
              <ShieldCheck className="w-4 h-4 text-[#A83232] shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                Student Assistant accounts require a valid <strong className="text-[#332F2B]">Invitation Code</strong> issued by the Head Librarian and are activated upon approval.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FORGOT PASSWORD MODAL
      ===================================================================== */}
      {showForgotPassword && (
        <div className="fixed inset-0 z-50 bg-[#332F2B]/60 backdrop-blur-xs overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-start min-h-screen">
          <div className="max-w-md w-full rounded-3xl p-6 sm:p-7 bg-white border border-[#E6D7C3] shadow-2xl relative overflow-hidden my-auto shrink-0 animate-literary-fade">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0 z-10" />
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-heading font-bold text-[#332F2B]">
                    Password Assistance
                  </h3>
                  <p className="text-xs text-[#6E665E]">LIRC Administrative Support</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-8 h-8 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE] hover:bg-[#F5EBDD] flex items-center justify-center text-[#6E665E] hover:text-[#332F2B] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[#FAF5EE] border border-[#E6D7C3] text-xs text-[#6E665E] space-y-2 leading-relaxed">
              <p className="text-[#332F2B] font-semibold">
                For security and privacy, Student Assistant and Staff credentials are administered by the LIRC Administration.
              </p>
              <p>
                If you have forgotten your password or require an account credential reset, please contact Head Librarian <strong>Dr. Maria Lorena Abangan</strong> or visit the LIRC Administration Office on the 2nd Floor.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-full h-11 rounded-2xl bg-[#2D2926] hover:bg-[#1E1B18] text-white font-semibold text-xs transition cursor-pointer"
              >
                Understood, Return to Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMIT INVITATION CODE MODAL
      ===================================================================== */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-[#332F2B]/60 backdrop-blur-xs overflow-y-auto p-3 sm:p-6 flex flex-col items-center justify-start sm:justify-center min-h-screen">
          <div ref={inviteModalRef} className="rounded-2xl sm:rounded-3xl shadow-2xl max-w-md w-full p-4 sm:p-7 bg-white border border-[#E6D7C3] relative overflow-hidden my-auto shrink-0 max-h-[92vh] overflow-y-auto">
            <div className="h-1.5 w-full bg-[#A83232] absolute top-0 left-0 z-10" />

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232]">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-lg font-heading font-bold text-[#332F2B]">
                    Submit Invitation Code
                  </h3>
                  <p className="text-[11px] text-[#6E665E]">
                    Step 2 of 2 · Librarian Authorization
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={submittingRegistration}
                onClick={() => setShowInviteModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#6E665E] mb-3">
              Enter the Librarian invitation code provided to submit your registration.
            </p>

            {/* Applicant Personal Details Summary */}
            <div className="p-3.5 rounded-2xl bg-[#FAF5EE] border border-[#E6D7C3] mb-4 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#332F2B]">{fullName.trim()}</span>
                <span className="font-mono font-semibold text-[#A83232]">
                  @{newUsername.trim().toLowerCase()}
                </span>
              </div>
              <div className="text-[#6E665E] font-stat">
                ID: {studentId.trim()} · {courseDepartment.trim()}
              </div>
            </div>

            {inviteModalError && (
              <div className="mb-4 p-3 rounded-2xl bg-[#FDF3F3] border border-[#A83232]/30 text-[#A83232] text-xs font-medium">
                {inviteModalError}
              </div>
            )}

            <form onSubmit={handleConfirmInvitationCodeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1.5">
                  Librarian Invitation Code
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={invitationCodeInput}
                  onChange={(e) => setInvitationCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. LIRC-8F4K2M"
                  className="w-full h-11 px-3.5 rounded-2xl bg-white border border-[#D6C3A9] text-[#332F2B] font-mono font-bold tracking-wider text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={submittingRegistration}
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#D6C3A9] bg-white hover:bg-[#FAF5EE] text-xs font-semibold text-[#332F2B] cursor-pointer"
                >
                  Back to Details
                </button>
                <button
                  type="submit"
                  disabled={submittingRegistration}
                  className="px-4 py-2 rounded-xl bg-[#2D2926] hover:bg-[#1E1B18] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {submittingRegistration ? 'Verifying & Submitting...' : 'Submit Registration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          INSTALL APPLICATION MODAL (WINDOWS / ANDROID / IOS)
      ===================================================================== */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-literary-fade overflow-y-auto">
          <div className="w-full max-w-md bg-white dark:bg-[#1E1B18] rounded-2xl sm:rounded-3xl shadow-2xl border border-[#E6D7C3] dark:border-[#3D342C] p-4 sm:p-6 relative overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0" />

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#FEF9EC] dark:bg-[#2A241E] border border-[#E7B84B]/60 flex items-center justify-center text-[#7D5B06] dark:text-[#E7B84B]">
                  <Download className="w-5 h-5 text-[#A83232] dark:text-[#E7B84B]" />
                </div>
                <div>
                  <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#FAF5EE]">
                    Install LIRC STAT
                  </h3>
                  <p className="text-[11px] text-[#6E665E] dark:text-[#A89C8F]">
                    Run as a standalone desktop or mobile application
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="p-1.5 rounded-xl hover:bg-[#FAF5EE] dark:hover:bg-[#2A241E] text-[#6E665E] dark:text-[#A89C8F] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Platform Selector Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#FAF5EE] dark:bg-[#25201C] border border-[#E6D7C3] dark:border-[#3D342C] mb-4">
              <button
                type="button"
                onClick={() => setActiveInstallTab('windows')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  activeInstallTab === 'windows'
                    ? 'bg-white dark:bg-[#332B24] text-[#A83232] dark:text-[#E7B84B] shadow-2xs font-bold'
                    : 'text-[#6E665E] dark:text-[#A89C8F] hover:text-[#332F2B]'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>Windows / PC</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveInstallTab('android')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  activeInstallTab === 'android'
                    ? 'bg-white dark:bg-[#332B24] text-[#A83232] dark:text-[#E7B84B] shadow-2xs font-bold'
                    : 'text-[#6E665E] dark:text-[#A89C8F] hover:text-[#332F2B]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Android</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveInstallTab('ios')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  activeInstallTab === 'ios'
                    ? 'bg-white dark:bg-[#332B24] text-[#A83232] dark:text-[#E7B84B] shadow-2xs font-bold'
                    : 'text-[#6E665E] dark:text-[#A89C8F] hover:text-[#332F2B]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>iPhone / iPad</span>
              </button>
            </div>

            {/* Tab Instructions Content */}
            <div className="p-4 rounded-2xl bg-[#FAF5EE]/70 dark:bg-[#25201C]/60 border border-[#E6D7C3] dark:border-[#3D342C] mb-5 text-xs text-[#332F2B] dark:text-[#FAF5EE] space-y-2.5">
              {activeInstallTab === 'windows' && (
                <>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#A83232] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <p className="leading-relaxed">
                      Click the <strong>three dots menu (⋮)</strong> at the top right of your browser (next to your profile).
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#A83232] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <p className="leading-relaxed">
                      Select <strong>"Save and share"</strong> → <strong>"Install page as app..."</strong> (or <strong>"Install LIRC STAT"</strong>).
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#A83232] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      3
                    </span>
                    <p className="leading-relaxed">
                      Click <strong>Install</strong>. A desktop shortcut will be added and the app will open in its own clean window.
                    </p>
                  </div>
                </>
              )}

              {activeInstallTab === 'android' && (
                <>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#7D5B06] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <p className="leading-relaxed">
                      Open this website in <strong>Google Chrome</strong> on your phone or tablet.
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#7D5B06] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <p className="leading-relaxed">
                      Tap the <strong>three dots (⋮)</strong> menu in the upper-right corner.
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#7D5B06] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      3
                    </span>
                    <p className="leading-relaxed">
                      Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                    </p>
                  </div>
                </>
              )}

              {activeInstallTab === 'ios' && (
                <>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#3B5998] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <p className="leading-relaxed">
                      Open this website in <strong>Safari</strong> on your iPhone or iPad.
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#3B5998] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <p className="leading-relaxed">
                      Tap the <strong>Share button</strong> at the bottom of the screen (square with upward arrow).
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#3B5998] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                      3
                    </span>
                    <p className="leading-relaxed">
                      Scroll down and tap <strong>"Add to Home Screen"</strong>, then tap <strong>Add</strong> in the top-right.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5">
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={handleInstallAppClick}
                  className="px-4 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install Now</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-2 rounded-xl border border-[#D6C3A9] dark:border-[#3D342C] bg-white dark:bg-[#241F1A] hover:bg-[#FAF5EE] dark:hover:bg-[#2D2721] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] cursor-pointer transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
