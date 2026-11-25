import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogOut,
  Menu,
  PanelLeft,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { UserProfile } from '../types/lirc';
import { TopProgressBar } from './TopProgressBar';
import { gsapPopIn } from '../utils/animations';
import { ThemeToggle } from '../context/ThemeContext';

export interface NavItem {
  id: string;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeTone?: 'burgundy' | 'mustard' | 'sage';
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  tone: 'mustard' | 'sage' | 'burgundy';
  onClick?: () => void;
}

interface AcademicLayoutProps {
  profile: UserProfile;
  roleLabel: string;
  pageTitle: string;
  pageSubtitle?: string;
  breadcrumbs: string[];
  navItems: NavItem[];
  activeNavId: string;
  onSelectNav: (id: string) => void;
  onSignOut: () => void;
  clockDateLabel: string;
  clockTimeLabel: string;
  isOperatingHours?: boolean;
  notifications?: NotificationItem[];
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (val: string) => void;
  headerActions?: React.ReactNode;
  isLoading?: boolean;
  children: React.ReactNode;
}

export const AcademicLayout: React.FC<AcademicLayoutProps> = ({
  profile,
  roleLabel,
  pageTitle,
  pageSubtitle,
  breadcrumbs,
  navItems,
  activeNavId,
  onSelectNav,
  onSignOut,
  clockDateLabel,
  clockTimeLabel,
  isOperatingHours = false,
  notifications = [],
  searchValue,
  searchPlaceholder = 'Search records...',
  onSearchChange,
  headerActions,
  isLoading,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('lirc_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const toggleSidebarCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lirc_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const activeEl = document.activeElement;
        const isInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl instanceof HTMLSelectElement;
        if (!isInput) {
          e.preventDefault();
          toggleSidebarCollapsed();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notifOpen && notifDropdownRef.current) {
      gsapPopIn(notifDropdownRef.current, { scale: 0.95, duration: 0.25 });
    }
  }, [notifOpen]);

  useEffect(() => {
    if (userMenuOpen && userDropdownRef.current) {
      gsapPopIn(userDropdownRef.current, { scale: 0.95, duration: 0.25 });
    }
  }, [userMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Group nav items preserving group order
  const groups = Array.from(new Set(navItems.map((i) => i.group)));

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen bg-[#F5EBDD] text-[#332F2B] flex relative">
      {/* Instant Top Progress Bar */}
      <TopProgressBar watchKey={activeNavId} isLoading={isLoading} />

      {/* Real Library Photographic Ambient Background */}
      <div
        className="fixed inset-0 pointer-events-none z-0 bg-cover bg-center bg-no-repeat opacity-[0.15] mix-blend-multiply transition-opacity duration-300"
        style={{ backgroundImage: `url('/library-bg.jpg')` }}
        aria-hidden="true"
      />

      {/* Mobile Sidebar Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-[#1A1613]/50 backdrop-blur-xs lg:hidden transition-opacity duration-300 ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Left Sidebar Navigation (Desktop Collapsible Rail + Mobile Slide-Out Drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 bg-[#FFFFFF] dark:bg-[#181512] border-r border-[#E6D7C3] dark:border-[#383028] flex flex-col justify-between overflow-x-hidden transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)] lg:sticky lg:top-0 lg:h-screen lg:z-20 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          isCollapsed ? 'w-72 lg:w-20' : 'w-72 lg:w-64'
        }`}
      >
        <div>
          {/* Top Logo & System Name / Collapse Controls */}
          <div
            className={`border-b border-[#E6D7C3] dark:border-[#383028] transition-all duration-300 ${
              isCollapsed
                ? 'py-3.5 px-2 flex flex-col items-center gap-2'
                : 'px-4 py-4 flex items-center justify-between gap-2.5'
            }`}
          >
            {isCollapsed ? (
              <>
                {/* Logo kept at the same size and position in the collapsed sidebar */}
                <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-center p-0.5 shadow-2xs shrink-0 group hover:scale-105 transition-transform duration-200">
                  <img src="/logo.png" alt="LIRC MANAGEMENT SYSTEM Logo" className="w-full h-full object-contain" />
                </div>

                {/* Greater-than (>) Expand Toggle Button directly below the logo, matching the less-than (<) collapse button */}
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="p-1.5 rounded-lg text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-[#FFFFFF] hover:bg-[#F5EBDD] dark:hover:bg-[#251F1A] border border-transparent hover:border-[#E6D7C3] dark:hover:border-[#383028] cursor-pointer transition-all duration-150 flex items-center justify-center shrink-0"
                  aria-label="Expand sidebar"
                  title="Expand sidebar (Ctrl+B)"
                >
                  <ChevronRight className="w-4 h-4 text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-[#FFFFFF] transition-colors" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-center p-1 shadow-2xs shrink-0 group hover:scale-105 transition-transform duration-200">
                    <img src="/logo.png" alt="LIRC MANAGEMENT SYSTEM Logo" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-heading font-bold text-sm text-[#332F2B] dark:text-[#F0E8DE] leading-tight truncate">
                      LIRC MANAGEMENT SYSTEM
                    </div>
                    <div className="text-[11px] font-medium text-[#6E665E] dark:text-[#A6998C] truncate">
                      {roleLabel}
                    </div>
                  </div>
                </div>

                {/* Desktop Collapse Toggle Button */}
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="hidden lg:flex p-1.5 rounded-lg text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-[#FFFFFF] hover:bg-[#F5EBDD] dark:hover:bg-[#251F1A] border border-transparent hover:border-[#E6D7C3] dark:hover:border-[#383028] cursor-pointer transition-all duration-150 shrink-0"
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar (Ctrl+B)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Mobile Close Button */}
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="lg:hidden p-1.5 rounded-lg text-[#6E665E] dark:text-[#A6998C] hover:bg-[#F5EBDD] dark:hover:bg-[#251F1A] cursor-pointer"
                  aria-label="Close sidebar"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Navigation Groups */}
          <div className={`py-4 space-y-4 overflow-y-auto overflow-x-hidden ${isCollapsed ? 'px-2' : 'px-3.5'}`}>
            {groups.map((grp) => {
              const items = navItems.filter((i) => i.group === grp);
              return (
                <div key={grp}>
                  {/* Group header: Text in expanded mode, divider in collapsed mode */}
                  {isCollapsed ? (
                    <div className="my-2 mx-auto w-6 h-[1px] bg-[#E6D7C3] dark:bg-[#383028]" />
                  ) : (
                    <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-[#6E665E] dark:text-[#A6998C] transition-opacity duration-200">
                      {grp}
                    </div>
                  )}

                  <nav className="space-y-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeNavId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onSelectNav(item.id);
                            setSidebarOpen(false);
                          }}
                          title={
                            isCollapsed
                              ? item.badge !== undefined
                                ? `${item.label} (${item.badge})`
                                : item.label
                              : undefined
                          }
                          aria-label={item.label}
                          className={`w-full rounded-xl text-xs font-semibold transition-all duration-200 relative group cursor-pointer ${
                            isCollapsed
                              ? 'h-11 flex items-center justify-center'
                              : 'px-3 py-2.5 flex items-center justify-between gap-2.5 hover:translate-x-0.5'
                          } ${
                            isActive
                              ? 'bg-gradient-to-r from-[#A83232] via-[#942727] to-[#7C1E1E] text-[#FFFFFF] shadow-sm shadow-[#A83232]/25'
                              : 'text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#F5EBDD] dark:hover:bg-[#251F1A]'
                          }`}
                        >
                          {/* Active Gold Indicator Bar */}
                          {isActive && (
                            <span
                              className="absolute left-0 inset-y-1.5 w-1 bg-[#E7B84B] rounded-r-full shadow-xs transition-all duration-200"
                            />
                          )}

                          <span className={`flex items-center gap-2.5 ${isCollapsed ? 'justify-center' : 'truncate'}`}>
                            <Icon
                              className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                                isActive
                                  ? 'text-[#FFFFFF]'
                                  : 'text-[#6E665E] dark:text-[#A6998C] group-hover:text-[#A83232] dark:group-hover:text-[#E25D5D]'
                              }`}
                            />
                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                          </span>

                          {/* Badge in Expanded Mode */}
                          {!isCollapsed && item.badge !== undefined && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-stat shrink-0 transition-colors ${
                                isActive
                                  ? 'bg-[#FFFFFF]/20 text-[#FFFFFF]'
                                  : item.badgeTone === 'mustard'
                                  ? 'bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/50'
                                  : item.badgeTone === 'sage'
                                  ? 'bg-[#F1F5EE] dark:bg-[#1A2616] text-[#455436] dark:text-[#A7D38C] border border-[#71865A]/40'
                                  : 'bg-[#FDF3F3] dark:bg-[#2D1616] text-[#A83232] dark:text-[#E25D5D] border border-[#A83232]/25'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}

                          {/* Badge Pip in Collapsed Mode */}
                          {isCollapsed && item.badge !== undefined && (
                            <span
                              className={`absolute top-1.5 right-2 w-2 h-2 rounded-full ${
                                item.badgeTone === 'mustard'
                                  ? 'bg-[#E7B84B]'
                                  : item.badgeTone === 'sage'
                                  ? 'bg-[#71865A]'
                                  : 'bg-[#A83232]'
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Sidebar Server Clock & Schedule Card */}
        <div
          className={`border-t border-[#E6D7C3] dark:border-[#383028] transition-all duration-300 ${
            isCollapsed ? 'p-2 space-y-2' : 'p-4 space-y-3'
          }`}
        >
          {isCollapsed ? (
            /* Collapsed Compact Server Clock Icon */
            <div
              className="w-12 h-11 mx-auto rounded-xl bg-gradient-to-br from-[#FFFFFF] via-[#FAF5EE] to-[#F5EBDD] dark:from-[#241F1A] dark:via-[#1D1915] dark:to-[#181512] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-center relative cursor-pointer shadow-2xs hover:scale-105 transition-transform"
              title={`Server Reference: ${clockTimeLabel} (${isOperatingHours ? 'Open' : 'Off-Hours'}) · ${clockDateLabel}`}
            >
              <Clock className="w-4 h-4 text-[#A83232] dark:text-[#E25D5D]" />
              <span
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                  isOperatingHours ? 'bg-[#71865A] animate-pulse' : 'bg-[#E7B84B]'
                }`}
              />
            </div>
          ) : (
            /* Expanded Full Server Reference Card */
            <div className="server-clock-card p-3.5 rounded-xl bg-gradient-to-br from-[#FFFFFF] via-[#FAF5EE] to-[#F5EBDD] dark:from-[#241F1A] dark:via-[#1D1915] dark:to-[#181512] border border-[#E6D7C3] dark:border-[#383028] shadow-xs space-y-1.5 transition-colors">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#332F2B] dark:text-[#F0E8DE]">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#A83232] dark:text-[#E25D5D]" />
                  Server Reference
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOperatingHours ? 'bg-[#71865A]' : 'bg-[#E7B84B]'
                  }`}
                />
              </div>
              <div className="font-stat font-bold text-sm text-[#332F2B] dark:text-[#FFFFFF]">
                {clockTimeLabel}
              </div>
              <div className="text-[11px] text-[#6E665E] dark:text-[#C5B7A8]">
                {clockDateLabel} · 8:00 AM – 6:00 PM
              </div>
            </div>
          )}

        </div>
      </aside>

      {/* Main Column: Top Header + Content */}
      <div className="flex-1 min-w-0 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]">
        {/* Clean Header */}
        <header className="bg-[#FFFFFF]/92 backdrop-blur-md border-b border-[#E6D7C3] sticky top-0 z-20 shadow-2xs">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
            {/* Left: Hamburger / Panel Toggle + Breadcrumbs & Page Title */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setSidebarOpen((v) => !v);
                  } else {
                    toggleSidebarCollapsed();
                  }
                }}
                className="p-1.5 sm:p-2 rounded-xl border border-[#E6D7C3] text-[#332F2B] hover:bg-[#F5EBDD] cursor-pointer shrink-0 transition-colors"
                aria-label="Toggle navigation menu"
                title="Toggle sidebar (Ctrl+B)"
              >
                <PanelLeft className="w-4 h-4" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-[#6E665E] mb-0.5 truncate">
                  {breadcrumbs.map((crumb, idx) => (
                    <React.Fragment key={crumb}>
                      {idx > 0 && <ChevronRight className="w-3 h-3 text-[#B8A284] shrink-0" />}
                      <span
                        className={`truncate ${
                          idx === breadcrumbs.length - 1
                            ? 'text-[#A83232] font-semibold'
                            : 'hover:text-[#332F2B]'
                        }`}
                        title={crumb}
                      >
                        {crumb}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
                <div className="flex items-baseline gap-x-2 min-w-0 overflow-hidden">
                  <h1
                    className="text-sm sm:text-lg md:text-xl font-heading font-bold text-[#332F2B] leading-tight shrink-0"
                    title={pageTitle}
                  >
                    {pageTitle}
                  </h1>
                  {pageSubtitle && (
                    <span
                      className="hidden md:inline text-xs sm:text-sm text-[#6E665E] leading-tight truncate min-w-0"
                      title={pageSubtitle}
                    >
                      · {pageSubtitle}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Search (optional) + Header Actions + Notifications + User Menu */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              {onSearchChange && (
                <div className="hidden md:block relative w-44 lg:w-56 transition-all duration-150 focus-within:w-60">
                  <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={searchValue || ''}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full h-9 pl-8 pr-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs text-[#332F2B] placeholder-[#6E665E] focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                </div>
              )}

              {headerActions}

              {/* Dark / Light Mode Toggle */}
              <ThemeToggle />

              {/* Notification Icon & Dropdown */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  className="relative p-1.5 sm:p-2 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] transition cursor-pointer"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.length > 0 && (
                    <span className="min-w-[16px] sm:min-w-[18px] h-[16px] sm:h-[18px] px-0.5 sm:px-1 rounded-full bg-[#A83232] text-[#FFFFFF] text-[9px] sm:text-[10px] font-stat font-bold flex items-center justify-center border-2 border-[#FFFFFF] absolute -top-1 -right-1 sm:-top-1.5 sm:-right-1.5">
                      {notifications.length}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div ref={notifDropdownRef} className="absolute right-0 mt-2 w-[calc(100vw-24px)] max-w-sm sm:w-96 bg-[#FFFFFF] rounded-2xl border border-[#E6D7C3] shadow-xl py-2 z-50">
                    <div className="px-4 py-2 border-b border-[#E6D7C3] flex items-center justify-between">
                      <span className="text-xs font-bold text-[#332F2B]">
                        System &amp; Duty Notifications
                      </span>
                      <span className="text-[11px] font-stat font-semibold px-2 py-0.5 rounded-full bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]/50">
                        {notifications.length}
                      </span>
                    </div>

                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-[#6E665E]">
                        All library intervals are up to date.
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto divide-y divide-[#E6D7C3]/60">
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              n.onClick?.();
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[#FAF5EE] transition flex items-start gap-2.5 cursor-pointer"
                          >
                            <span
                              className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                n.tone === 'mustard'
                                  ? 'bg-[#E7B84B]'
                                  : n.tone === 'sage'
                                  ? 'bg-[#71865A]'
                                  : 'bg-[#A83232]'
                              }`}
                            />
                            <div>
                              <div className="text-xs font-semibold text-[#332F2B]">
                                {n.title}
                              </div>
                              <div className="text-[11px] text-[#6E665E] mt-0.5">
                                {n.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* User Profile & Account Menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 sm:gap-2.5 p-1 sm:pl-2 sm:pr-2.5 sm:py-1.5 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] transition cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#A83232] text-[#FFFFFF] text-xs font-bold flex items-center justify-center shrink-0">
                    {initials || 'U'}
                  </div>
                  <div className="hidden sm:block text-left">
                    <div className="text-xs font-semibold text-[#332F2B] leading-tight max-w-[130px] truncate">
                      {profile.full_name}
                    </div>
                    <div className="text-[10px] text-[#6E665E] leading-tight">
                      {profile.staff_code}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#6E665E] hidden sm:block shrink-0" />
                </button>

                {userMenuOpen && (
                  <div ref={userDropdownRef} className="absolute right-0 mt-2 w-56 sm:w-60 bg-[#FFFFFF] rounded-2xl border border-[#E6D7C3] shadow-xl py-2 z-50">
                    <div className="px-4 py-2.5 border-b border-[#E6D7C3]">
                      <div className="text-xs font-bold text-[#332F2B]">
                        {profile.full_name}
                      </div>
                      <div className="text-[11px] font-mono text-[#A83232] truncate">
                        @{profile.username}
                      </div>
                      <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F5EE] text-[#455436] border border-[#71865A]/40">
                        {profile.role === 'librarian' ? (
                          <ShieldCheck className="w-3 h-3 text-[#71865A]" />
                        ) : (
                          <UserCheck className="w-3 h-3 text-[#71865A]" />
                        )}
                        {roleLabel}
                      </div>
                    </div>

                    <div className="px-4 py-2.5 text-[11px] text-[#6E665E] border-b border-[#E6D7C3]">
                      <div>Staff ID: <strong className="text-[#332F2B] font-stat">{profile.staff_code}</strong></div>
                    </div>

                    <div className="px-2 pt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-[#A83232] hover:bg-[#FDF3F3] transition flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-literary-fade">
          {children}
        </main>
      </div>
    </div>
  );
};
