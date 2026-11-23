import React from 'react';

interface AnimatedBookLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  priority?: boolean;
}

export const AnimatedBookLogo: React.FC<AnimatedBookLogoProps> = ({
  className = 'h-20 sm:h-24 md:h-28 w-auto',
  size = 'hero',
}) => {
  return (
    <div
      className={`relative inline-block select-none group ${className}`}
      style={{
        aspectRatio: '1024 / 682',
        perspective: '1200px',
      }}
      title="LIRC STAT — Learning & Information Resource Center"
    >
      <style>{`
        @keyframes book-float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        /* Continuous gentle wave on the left page */
        @keyframes left-page-flutter {
          0%, 100% {
            transform: rotate(0deg) skewY(0deg) scale(1);
          }
          33% {
            transform: rotate(-0.8deg) skewY(-0.6deg) scale(1.006);
          }
          66% {
            transform: rotate(0.6deg) skewY(0.4deg) scale(0.996);
          }
        }

        /* Continuous gentle wave on the right page */
        @keyframes right-page-flutter {
          0%, 100% {
            transform: rotate(0deg) skewY(0deg) scale(1);
          }
          33% {
            transform: rotate(0.9deg) skewY(0.6deg) scale(1.008);
          }
          66% {
            transform: rotate(-0.5deg) skewY(-0.4deg) scale(0.994);
          }
        }

        /* 3D Realistic Page-Flipping Keyframes (Right to Left across the spine) */
        @keyframes page-turn-3d {
          0% {
            transform: rotateY(0deg) rotateZ(0deg) skewY(0deg);
            opacity: 0;
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
          4% {
            opacity: 0.98;
          }
          15% {
            transform: rotateY(-25deg) rotateZ(-1.5deg) skewY(-1.5deg);
            box-shadow: -4px 6px 14px rgba(70, 15, 15, 0.18);
          }
          35% {
            transform: rotateY(-65deg) rotateZ(-3.5deg) skewY(-4deg);
            box-shadow: -10px 14px 22px rgba(60, 10, 10, 0.28);
          }
          50% {
            transform: rotateY(-90deg) rotateZ(-4deg) skewY(-5deg);
            box-shadow: 0 16px 26px rgba(40, 5, 5, 0.35);
          }
          65% {
            transform: rotateY(-115deg) rotateZ(-3.5deg) skewY(-4deg);
            box-shadow: 10px 14px 22px rgba(60, 10, 10, 0.28);
          }
          85% {
            transform: rotateY(-155deg) rotateZ(-1.5deg) skewY(-1.5deg);
            box-shadow: 4px 6px 14px rgba(70, 15, 15, 0.18);
            opacity: 0.98;
          }
          96% {
            transform: rotateY(-180deg) rotateZ(0deg) skewY(0deg);
            opacity: 0.9;
          }
          100% {
            transform: rotateY(-180deg) rotateZ(0deg) skewY(0deg);
            opacity: 0;
          }
        }

        /* Traveling shadow cast on right page when leaf lifts */
        @keyframes right-shadow-sweep {
          0% {
            opacity: 0;
            transform: scaleX(0.2);
          }
          15% {
            opacity: 0.35;
            transform: scaleX(0.85);
          }
          45% {
            opacity: 0.1;
            transform: scaleX(1);
          }
          50%, 100% {
            opacity: 0;
          }
        }

        /* Traveling shadow cast on left page when leaf lands */
        @keyframes left-shadow-sweep {
          0%, 50% {
            opacity: 0;
            transform: scaleX(0.2);
          }
          60% {
            opacity: 0.15;
            transform: scaleX(0.7);
          }
          85% {
            opacity: 0.35;
            transform: scaleX(1);
          }
          100% {
            opacity: 0;
            transform: scaleX(1);
          }
        }

        /* Subtle golden light sheen across the turning page */
        @keyframes page-sheen {
          0%, 10% {
            opacity: 0;
            transform: translateX(-30%);
          }
          40%, 60% {
            opacity: 0.75;
            transform: translateX(40%);
          }
          90%, 100% {
            opacity: 0;
            transform: translateX(110%);
          }
        }

        .anim-book-float {
          animation: book-float 4.2s ease-in-out infinite;
        }

        .anim-left-flutter {
          transform-origin: 90% 70%;
          animation: left-page-flutter 3.8s ease-in-out infinite;
        }

        .anim-right-flutter {
          transform-origin: 10% 70%;
          animation: right-page-flutter 3.5s ease-in-out infinite;
        }

        .anim-page-turn-1 {
          animation: page-turn-3d 4.4s cubic-bezier(0.42, 0.0, 0.58, 1.0) infinite;
        }

        .anim-page-turn-2 {
          animation: page-turn-3d 4.4s cubic-bezier(0.42, 0.0, 0.58, 1.0) infinite 1.45s;
        }

        .anim-page-turn-3 {
          animation: page-turn-3d 4.4s cubic-bezier(0.42, 0.0, 0.58, 1.0) infinite 2.9s;
        }

        .anim-right-shadow-1 {
          animation: right-shadow-sweep 4.4s ease-out infinite;
        }
        .anim-right-shadow-2 {
          animation: right-shadow-sweep 4.4s ease-out infinite 1.45s;
        }
        .anim-right-shadow-3 {
          animation: right-shadow-sweep 4.4s ease-out infinite 2.9s;
        }

        .anim-left-shadow-1 {
          animation: left-shadow-sweep 4.4s ease-out infinite;
        }
        .anim-left-shadow-2 {
          animation: left-shadow-sweep 4.4s ease-out infinite 1.45s;
        }
        .anim-left-shadow-3 {
          animation: left-shadow-sweep 4.4s ease-out infinite 2.9s;
        }

        /* Hover speeds up the page turning for an interactive leafing effect */
        .group:hover .anim-page-turn-1 {
          animation-duration: 2.2s;
        }
        .group:hover .anim-page-turn-2 {
          animation-duration: 2.2s;
          animation-delay: 0.73s;
        }
        .group:hover .anim-page-turn-3 {
          animation-duration: 2.2s;
          animation-delay: 1.46s;
        }
      `}</style>

      {/* Floating Book Shell with Gentle Organic Hover */}
      <div className="w-full h-full relative anim-book-float">
        {/* Soft Ambient Table Glow / Shadow underneath */}
        <div
          className="absolute -bottom-2 left-[12%] right-[12%] h-4 rounded-full bg-gradient-to-r from-transparent via-[#4A1116]/20 dark:via-black/40 to-transparent blur-md pointer-events-none transition-all duration-500 group-hover:scale-x-110 group-hover:opacity-80"
          aria-hidden="true"
        />

        {/* Base Logo Image */}
        <img
          src="/logo.png"
          alt="LIRC STAT Logo"
          className="w-full h-full object-contain relative z-0 drop-shadow-md select-none transition-transform duration-300 group-hover:scale-[1.02]"
          draggable={false}
        />

        {/* =================================================================
            SVG LAYER 1: Subtle Organic Surface Wave over Left & Right Pages
        ================================================================= */}
        <svg
          viewBox="0 0 1024 682"
          className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
          aria-hidden="true"
        >
          {/* Left Page Soft Shimmer & Wind Wave */}
          <g className="anim-left-flutter">
            {/* Top Page Leaf Shimmer Overlay */}
            <path
              d="M 512 324 C 424 238, 324 198, 232 179 C 214 238, 199 308, 189 370 C 294 418, 404 458, 512 464 Z"
              fill="url(#leftParchmentGrad)"
              opacity="0.28"
            />
          </g>

          {/* Right Page Soft Shimmer & Wind Wave */}
          <g className="anim-right-flutter">
            {/* Top Page Leaf Shimmer Overlay */}
            <path
              d="M 512 324 C 600 238, 700 198, 792 179 C 810 238, 825 308, 835 370 C 730 418, 620 458, 512 464 Z"
              fill="url(#rightParchmentGrad)"
              opacity="0.28"
            />
          </g>

          {/* Gradients */}
          <defs>
            <linearGradient id="leftParchmentGrad" x1="100%" y1="50%" x2="0%" y2="50%">
              <stop offset="0%" stopColor="#4A1010" stopOpacity="0.2" />
              <stop offset="40%" stopColor="#FFFDF7" stopOpacity="0.5" />
              <stop offset="80%" stopColor="#F7EED8" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#FFFDF7" stopOpacity="0.3" />
            </linearGradient>

            <linearGradient id="rightParchmentGrad" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#4A1010" stopOpacity="0.2" />
              <stop offset="40%" stopColor="#FFFDF7" stopOpacity="0.5" />
              <stop offset="80%" stopColor="#F7EED8" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#FFFDF7" stopOpacity="0.3" />
            </linearGradient>

            <linearGradient id="pageSheenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.7" />
              <stop offset="55%" stopColor="#FFEFC2" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* =================================================================
            3D PAGE TURNING CONTAINER
            Positioned right at the center spine of the book (X = 50%)
        ================================================================= */}
        <div
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          style={{
            transformStyle: 'preserve-3d',
          }}
          aria-hidden="true"
        >
          {/* Dynamic Traveling Shadows on Right Page */}
          <div
            className="absolute top-[26.5%] left-[50%] w-[31.5%] h-[42.5%] origin-left pointer-events-none anim-right-shadow-1"
            style={{
              background: 'radial-gradient(ellipse at 15% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(0% 28%, 89% 0%, 100% 59%, 0% 100%)',
            }}
          />
          <div
            className="absolute top-[26.5%] left-[50%] w-[31.5%] h-[42.5%] origin-left pointer-events-none anim-right-shadow-2"
            style={{
              background: 'radial-gradient(ellipse at 15% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(0% 28%, 89% 0%, 100% 59%, 0% 100%)',
            }}
          />
          <div
            className="absolute top-[26.5%] left-[50%] w-[31.5%] h-[42.5%] origin-left pointer-events-none anim-right-shadow-3"
            style={{
              background: 'radial-gradient(ellipse at 15% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(0% 28%, 89% 0%, 100% 59%, 0% 100%)',
            }}
          />

          {/* Dynamic Traveling Shadows on Left Page */}
          <div
            className="absolute top-[26.5%] right-[50%] w-[31.5%] h-[42.5%] origin-right pointer-events-none anim-left-shadow-1"
            style={{
              background: 'radial-gradient(ellipse at 85% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(11% 0%, 100% 28%, 100% 100%, 0% 59%)',
            }}
          />
          <div
            className="absolute top-[26.5%] right-[50%] w-[31.5%] h-[42.5%] origin-right pointer-events-none anim-left-shadow-2"
            style={{
              background: 'radial-gradient(ellipse at 85% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(11% 0%, 100% 28%, 100% 100%, 0% 59%)',
            }}
          />
          <div
            className="absolute top-[26.5%] right-[50%] w-[31.5%] h-[42.5%] origin-right pointer-events-none anim-left-shadow-3"
            style={{
              background: 'radial-gradient(ellipse at 85% 50%, rgba(50, 10, 10, 0.45) 0%, rgba(60, 15, 15, 0.15) 50%, transparent 80%)',
              clipPath: 'polygon(11% 0%, 100% 28%, 100% 100%, 0% 59%)',
            }}
          />

          {/* ===============================================================
              3D TURNING PAGE LEAVES (1, 2, 3)
          =============================================================== */}
          {[1, 2, 3].map((leafNum) => (
            <div
              key={`turning-leaf-${leafNum}`}
              className={`absolute top-[26.4%] left-[50%] w-[31.5%] h-[42.5%] anim-page-turn-${leafNum}`}
              style={{
                transformOrigin: '0% 68%',
                transformStyle: 'preserve-3d',
                backfaceVisibility: 'visible',
              }}
            >
              {/* SVG Page Leaf matching exact book geometry */}
              <svg
                viewBox="0 0 323 290"
                className="w-full h-full overflow-visible drop-shadow-sm"
                style={{
                  filter: 'drop-shadow(-3px 5px 6px rgba(45, 10, 10, 0.22))',
                }}
              >
                {/* Crimson Binding Contour */}
                <path
                  d="M 0 146 C 88 60, 188 20, 280 1 C 298 60, 313 130, 323 192 C 218 240, 108 280, 0 286 Z"
                  fill="#7A0C16"
                  stroke="#5A0810"
                  strokeWidth="1.5"
                />

                {/* Inner Cream Paper Body */}
                <path
                  d="M 6 146 C 90 65, 186 27, 274 9 C 291 64, 305 130, 314 188 C 213 234, 106 273, 6 280 Z"
                  fill="url(#turningPaperGradient)"
                />

                {/* Subtle Scholarly Printed Page Lines */}
                <g opacity="0.32" stroke="#B8A485" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="45" y1="130" x2="235" y2="70" />
                  <line x1="40" y1="155" x2="245" y2="95" />
                  <line x1="35" y1="180" x2="250" y2="120" />
                  <line x1="30" y1="205" x2="255" y2="145" />
                  <line x1="25" y1="230" x2="260" y2="170" />
                </g>

                {/* Light Page Crest Highlight (Gleam as page bends) */}
                <path
                  d="M 12 146 C 92 68, 184 32, 270 14 C 275 35, 278 60, 280 85 C 195 110, 105 155, 14 200 Z"
                  fill="url(#crestHighlightGrad)"
                  opacity="0.55"
                />

                <defs>
                  <linearGradient id="turningPaperGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#F5EBDD" />
                    <stop offset="35%" stopColor="#FFFDF7" />
                    <stop offset="70%" stopColor="#FAF2E1" />
                    <stop offset="100%" stopColor="#F0E2CC" />
                  </linearGradient>

                  <linearGradient id="crestHighlightGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#FFF9E6" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
