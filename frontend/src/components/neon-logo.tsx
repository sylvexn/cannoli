import { useEffect, useState, useMemo } from 'react';

// SVG paths extracted from Pokemon Hollow.ttf for "cannoli"
// Font coords: unitsPerEm=2048, Y-up (flipped via transform)

const LETTERS = [
  {
    id: 'c',
    offset: 0,
    d: 'M823 1141Q707 1208 578 1208Q436 1208 307.0 1123.0Q178 1038 80 856Q37 773 6.0 675.0Q-25 577 -25 481Q-25 265 141 147Q280 47 449 47Q601 47 762 131Q800 151 853.5 203.0Q907 255 952.5 313.5Q998 372 1008 401L770 451Q736 386 692.0 339.0Q648 292 599.0 268.0Q550 244 498 244Q415 244 344 303Q262 370 262 512Q262 614 305.0 712.5Q348 811 427.0 874.5Q506 938 606 938Q666 938 708.5 916.5Q751 895 768 831L1008 893Q1007 909 995.0 947.0Q983 985 942.5 1039.5Q902 1094 823 1141ZM866 1188Q930 1147 981.5 1074.5Q1033 1002 1061.0 940.5Q1089 879 1098 852L727 770Q718 820 674.0 836.0Q630 852 582 852Q328 828 328 549Q335 328 467 303Q530 303 581.0 334.0Q632 365 668.5 416.5Q705 468 729 532L1100 457Q1094 437 1071 377Q1045 310 949.5 198.0Q854 86 737 41Q596 -14 457 -14Q235 -14 63 131Q-15 199 -50.5 289.0Q-86 379 -86 479Q-86 583 -57.0 684.0Q-28 785 14 868Q69 976 135.0 1052.5Q201 1129 273.5 1177.5Q346 1226 422.0 1249.0Q498 1272 575 1272Q733 1272 866 1188Z',
  },
  {
    id: 'a',
    offset: 1024,
    d: 'M664 979Q586 927 586 829Q586 761 616 737Q637 723 664 723V510Q638 506 623 506Q545 506 469 557Q383 614 383 705Q383 749 404.5 794.5Q426 840 464.0 878.0Q502 916 555.5 944.0Q609 972 664 979ZM672 1155 1090 1343 1098 784Q1106 732 1106 666Q1106 608 1102 580L1114 -33L664 -57V4Q554 -41 442 -41Q356 -41 280.5 -15.0Q205 11 150 55Q61 129 11.0 254.5Q-39 380 -39 520Q-39 761 100 909Q220 1035 347.5 1100.0Q475 1165 608 1165Q645 1165 664 1163ZM721 1130V1102Q705 1104 672 1104Q610 1104 547.0 1089.0Q484 1074 416.5 1043.0Q349 1012 284.0 965.0Q219 918 166 860Q117 807 87.0 747.5Q57 688 42.0 623.5Q27 559 27 494Q27 367 76.5 258.5Q126 150 211 92Q278 45 403 45Q566 45 721 119V-8L1049 16L1040 1270Z',
  },
  {
    id: 'n1',
    offset: 2048,
    d: 'M57 672Q64 617 67 544Q69 471 76 339Q82 206 85.5 159.5Q89 113 98 49L475 90Q455 257 455 401Q455 598 492 770Q505 826 530.5 869.0Q556 912 590.0 934.0Q624 956 659 956Q695 956 728.5 935.0Q762 914 791.0 872.0Q820 830 844 762Q877 669 901.5 497.5Q926 326 926 182Q926 127 918 57L1221 66Q1221 95 1238.0 232.5Q1255 370 1255 469Q1255 662 1180 811Q1114 943 1076.5 1001.5Q1039 1060 950 1114Q870 1163 748 1163Q603 1163 410 1090L369 1155L41 1114ZM434 1155Q545 1192 625.0 1211.5Q705 1231 778 1231Q876 1231 950 1188Q1039 1137 1142.0 1014.0Q1245 891 1270 786Q1323 573 1323 414Q1323 330 1312.0 237.5Q1301 145 1278 0L860 -25Q862 25 862 119Q862 511 754 786Q712 889 672 889Q620 889 557 745Q542 710 532.5 665.0Q523 620 518.5 564.0Q514 508 514 432Q514 278 532 41L41 -16Q29 72 19.0 159.0Q9 246 3.5 320.5Q-2 395 -2 481Q-2 518 2 588L-16 1171L377 1221Z',
  },
  {
    id: 'n2',
    offset: 3277,
    d: 'M57 672Q64 617 67 544Q69 471 76 339Q82 206 85.5 159.5Q89 113 98 49L475 90Q455 257 455 401Q455 598 492 770Q505 826 530.5 869.0Q556 912 590.0 934.0Q624 956 659 956Q695 956 728.5 935.0Q762 914 791.0 872.0Q820 830 844 762Q877 669 901.5 497.5Q926 326 926 182Q926 127 918 57L1221 66Q1221 95 1238.0 232.5Q1255 370 1255 469Q1255 662 1180 811Q1114 943 1076.5 1001.5Q1039 1060 950 1114Q870 1163 748 1163Q603 1163 410 1090L369 1155L41 1114ZM434 1155Q545 1192 625.0 1211.5Q705 1231 778 1231Q876 1231 950 1188Q1039 1137 1142.0 1014.0Q1245 891 1270 786Q1323 573 1323 414Q1323 330 1312.0 237.5Q1301 145 1278 0L860 -25Q862 25 862 119Q862 511 754 786Q712 889 672 889Q620 889 557 745Q542 710 532.5 665.0Q523 620 518.5 564.0Q514 508 514 432Q514 278 532 41L41 -16Q29 72 19.0 159.0Q9 246 3.5 320.5Q-2 395 -2 481Q-2 518 2 588L-16 1171L377 1221Z',
  },
  {
    id: 'o',
    offset: 4506,
    d: 'M866 1032Q781 1108 647 1108Q573 1108 491.0 1080.5Q409 1053 325.5 997.5Q242 942 166 860Q117 807 87.0 747.5Q57 688 42.0 623.5Q27 559 27 494Q27 367 76.5 258.5Q126 150 211 92Q299 31 428 31Q574 31 718.5 117.5Q863 204 952 369Q1034 515 1034 666Q1034 774 991.0 867.5Q948 961 866 1032ZM907 1083Q978 1045 1022.5 980.5Q1067 916 1087.5 835.5Q1108 755 1108 668Q1108 596 1096.5 529.0Q1085 462 1065.0 406.0Q1045 350 1018 311Q955 217 883.0 149.0Q811 81 736.0 39.5Q661 -2 587.5 -21.5Q514 -41 442 -41Q357 -41 280.5 -14.5Q204 12 150 55Q61 129 11.0 254.5Q-39 380 -39 520Q-39 761 100 909Q219 1036 346.0 1100.5Q473 1165 606 1165Q684 1165 756.0 1145.5Q828 1126 907 1083ZM848 915Q860 873 860 823Q860 750 831.0 675.5Q802 601 747.0 553.5Q692 506 621 506Q549 506 469 557Q383 612 383 705Q383 755 409.5 804.5Q436 854 480.0 893.5Q524 933 585.0 958.0Q646 983 713 983Q647 957 616.5 912.0Q586 867 586 821Q586 761 616 737Q637 723 664 723Q718 723 774.5 781.0Q831 839 848 915Z',
  },
  {
    id: 'l',
    offset: 5530,
    d: 'M492 -205 377 1810 -33 1638 -66 1499 74 1573 164 -229ZM557 -254 106 -279 16 1458 -131 1425 -82 1671 426 1884Z',
  },
  {
    id: 'i',
    offset: 6042,
    d: 'M475 -139 426 1212 16 1040 -16 901 123 975 147 -164ZM541 -188 90 -213 66 860 -82 827 -33 1073 475 1286ZM229 1827Q115 1792 115 1653Q123 1588 179.5 1557.0Q236 1526 293 1526Q351 1533 379.5 1583.5Q408 1634 408 1704Q402 1746 351.5 1788.5Q301 1831 252 1831Q247 1831 229 1827ZM213 1892Q284 1892 335.5 1868.5Q387 1845 420.0 1811.5Q453 1778 465 1753Q477 1726 477 1694Q477 1645 456.0 1594.5Q435 1544 405.0 1508.0Q375 1472 348 1466Q296 1458 270 1458Q204 1458 155.0 1481.0Q106 1504 77.0 1548.0Q48 1592 41 1651Q41 1736 82.5 1810.0Q124 1884 213 1892Z',
  },
];

const VIEW_BOX = '-120 -1960 6820 2350';

// Lighter tint of a hex color (for the hot core of the glow)
function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.75));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

interface NeonLogoProps {
  className?: string;
  /** Primary neon color — defaults to neon cyan */
  color?: string;
}

export function NeonLogo({ className, color = '#22d3ee' }: NeonLogoProps) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDrawn(true), 2400);
    return () => clearTimeout(timer);
  }, []);

  const coreColor = useMemo(() => lighten(color), [color]);

  return (
    <div className="neon-logo-wrapper">
      <svg
        viewBox={VIEW_BOX}
        className={`neon-logo-svg ${className ?? ''}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="cannoli"
        role="img"
        style={{ '--neon-color': color, '--neon-core': coreColor } as React.CSSProperties}
      >
        <defs>
          {/* Multi-layer neon glow */}
          <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="25" result="blur2" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="60" result="blur3" />
            <feMerge>
              <feMergeNode in="blur3" />
              <feMergeNode in="blur3" />
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Spark glow — tight and bright */}
          <filter id="spark-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b2" />
            <feMerge>
              <feMergeNode in="b1" />
              <feMergeNode in="b2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Shimmer turbulence on the ambient bloom */}
          <filter id="glow-shimmer" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="30" result="bloom" />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015 0.04"
              numOctaves={2}
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                values="0.015 0.04;0.025 0.06;0.015 0.04"
                dur="8s"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap in="bloom" in2="noise" scale={12} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        <g transform="scale(1,-1)">
          {/* Layer 1: Ambient shimmer bloom */}
          <g filter="url(#glow-shimmer)" opacity={0.35} className="neon-glow-layer">
            {LETTERS.map((l) => (
              <path
                key={`shimmer-${l.id}`}
                transform={`translate(${l.offset}, 0)`}
                d={l.d}
                fill={color}
                stroke="none"
              />
            ))}
          </g>

          {/* Layer 2: Glow strokes */}
          <g filter="url(#neon-glow)" opacity={0.7} className="neon-glow-layer">
            {LETTERS.map((l, i) => (
              <path
                key={`glow-${l.id}`}
                transform={`translate(${l.offset}, 0)`}
                d={l.d}
                fill="none"
                stroke={color}
                strokeWidth={14}
                className="neon-draw"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </g>

          {/* Layer 3: Crisp letter fills */}
          <g>
            {LETTERS.map((l, i) => (
              <path
                key={`fill-${l.id}`}
                transform={`translate(${l.offset}, 0)`}
                d={l.d}
                fill={color}
                stroke={coreColor}
                strokeWidth={4}
                className="neon-draw neon-fill"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </g>

          {/* Layer 4: Traveling spark */}
          {drawn && (
            <g filter="url(#spark-glow)">
              {LETTERS.map((l, i) => (
                <path
                  key={`spark-${l.id}`}
                  transform={`translate(${l.offset}, 0)`}
                  d={l.d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={10}
                  className="neon-spark"
                  style={{ animationDelay: `${i * 0.7}s` }}
                />
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
