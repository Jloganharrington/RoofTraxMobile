import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

// Feather-style icons rendered with react-native-svg instead of a font glyph.
// Expo Go on Android has a long-standing bug where dynamically-loaded custom
// icon fonts register successfully (Font.isLoaded() returns true) but still
// render as missing-glyph "tofu" boxes under the New Architecture renderer.
// Drawing icons as vectors sidesteps that entirely and works identically on
// iOS, Android, and web.
export type IconName =
  | 'map-pin'
  | 'users'
  | 'trash-2'
  | 'image'
  | 'camera'
  | 'alert-circle'
  | 'x'
  | 'smartphone'
  | 'upload'
  | 'check'
  | 'plus'
  | 'user'
  | 'log-out'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'clipboard'
  | 'clock'
  | 'award'
  | 'bar-chart-2'
  | 'home'
  | 'calendar'
  | 'cloud'
  | 'navigation'
  | 'play'
  | 'square'
  | 'wind'
  | 'edit-3'
  | 'server'
  | 'file-text';

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 24, color = '#000' }: IconProps) {
  const strokeProps = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...strokeProps} />}

      {name === 'x' && <Path d="M18 6 6 18M6 6l12 12" {...strokeProps} />}

      {name === 'check' && <Path d="M20 6 9 17l-5-5" {...strokeProps} />}

      {name === 'upload' && (
        <>
          <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...strokeProps} />
          <Polyline points="17 8 12 3 7 8" {...strokeProps} />
          <Line x1={12} y1={3} x2={12} y2={15} {...strokeProps} />
        </>
      )}

      {name === 'camera' && (
        <>
          <Path
            d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
            {...strokeProps}
          />
          <Circle cx={12} cy={13} r={4} {...strokeProps} />
        </>
      )}

      {name === 'image' && (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={2} ry={2} {...strokeProps} />
          <Circle cx={8.5} cy={8.5} r={1.5} {...strokeProps} />
          <Polyline points="21 15 16 10 5 21" {...strokeProps} />
        </>
      )}

      {name === 'trash-2' && (
        <>
          <Polyline points="3 6 5 6 21 6" {...strokeProps} />
          <Path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            {...strokeProps}
          />
          <Line x1={10} y1={11} x2={10} y2={17} {...strokeProps} />
          <Line x1={14} y1={11} x2={14} y2={17} {...strokeProps} />
        </>
      )}

      {name === 'users' && (
        <>
          <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" {...strokeProps} />
          <Circle cx={9} cy={7} r={4} {...strokeProps} />
          <Path d="M23 21v-2a4 4 0 0 0-3-3.87" {...strokeProps} />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" {...strokeProps} />
        </>
      )}

      {name === 'map-pin' && (
        <>
          <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" {...strokeProps} />
          <Circle cx={12} cy={10} r={3} {...strokeProps} />
        </>
      )}

      {name === 'edit-3' && (
        <>
          <Path d="M12 20h9" {...strokeProps} />
          <Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" {...strokeProps} />
        </>
      )}

      {name === 'server' && (
        <>
          <Rect x={2} y={2} width={20} height={8} rx={2} ry={2} {...strokeProps} />
          <Rect x={2} y={14} width={20} height={8} rx={2} ry={2} {...strokeProps} />
          <Line x1={6} y1={6} x2={6.01} y2={6} {...strokeProps} />
          <Line x1={6} y1={18} x2={6.01} y2={18} {...strokeProps} />
        </>
      )}

      {name === 'file-text' && (
        <>
          <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" {...strokeProps} />
          <Polyline points="14 2 14 8 20 8" {...strokeProps} />
          <Line x1={16} y1={13} x2={8} y2={13} {...strokeProps} />
          <Line x1={16} y1={17} x2={8} y2={17} {...strokeProps} />
          <Polyline points="10 9 9 9 8 9" {...strokeProps} />
        </>
      )}

      {name === 'alert-circle' && (
        <>
          <Circle cx={12} cy={12} r={10} {...strokeProps} />
          <Line x1={12} y1={8} x2={12} y2={12} {...strokeProps} />
          <Line x1={12} y1={16} x2={12.01} y2={16} {...strokeProps} />
        </>
      )}

      {name === 'smartphone' && (
        <>
          <Rect x={5} y={2} width={14} height={20} rx={2} ry={2} {...strokeProps} />
          <Line x1={12} y1={18} x2={12.01} y2={18} {...strokeProps} />
        </>
      )}

      {name === 'user' && (
        <>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...strokeProps} />
          <Circle cx={12} cy={7} r={4} {...strokeProps} />
        </>
      )}

      {name === 'chevron-down' && (
        <Polyline points="6 9 12 15 18 9" {...strokeProps} />
      )}

      {name === 'chevron-right' && (
        <Polyline points="9 18 15 12 9 6" {...strokeProps} />
      )}

      {name === 'chevron-left' && (
        <Polyline points="15 18 9 12 15 6" {...strokeProps} />
      )}

      {name === 'clock' && (
        <>
          <Circle cx={12} cy={12} r={10} {...strokeProps} />
          <Polyline points="12 6 12 12 16 14" {...strokeProps} />
        </>
      )}

      {name === 'award' && (
        <>
          <Circle cx={12} cy={8} r={7} {...strokeProps} />
          <Polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" {...strokeProps} />
        </>
      )}

      {name === 'bar-chart-2' && (
        <>
          <Line x1={18} y1={20} x2={18} y2={10} {...strokeProps} />
          <Line x1={12} y1={20} x2={12} y2={4} {...strokeProps} />
          <Line x1={6} y1={20} x2={6} y2={14} {...strokeProps} />
        </>
      )}

      {name === 'home' && (
        <>
          <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...strokeProps} />
          <Polyline points="9 22 9 12 15 12 15 22" {...strokeProps} />
        </>
      )}

      {name === 'calendar' && (
        <>
          <Rect x={3} y={4} width={18} height={18} rx={2} ry={2} {...strokeProps} />
          <Line x1={16} y1={2} x2={16} y2={6} {...strokeProps} />
          <Line x1={8} y1={2} x2={8} y2={6} {...strokeProps} />
          <Line x1={3} y1={10} x2={21} y2={10} {...strokeProps} />
        </>
      )}

      {name === 'cloud' && (
        <Path
          d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"
          {...strokeProps}
        />
      )}

      {name === 'navigation' && (
        <Path d="M3 11l19-9-9 19-2-8-8-2z" {...strokeProps} />
      )}

      {name === 'play' && <Path d="M5 3l14 9-14 9V3z" {...strokeProps} />}

      {name === 'square' && (
        <Rect x={5} y={5} width={14} height={14} rx={2} ry={2} {...strokeProps} />
      )}

      {name === 'wind' && (
        <Path
          d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"
          {...strokeProps}
        />
      )}

      {name === 'log-out' && (
        <>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...strokeProps} />
          <Polyline points="16 17 21 12 16 7" {...strokeProps} />
          <Line x1={21} y1={12} x2={9} y2={12} {...strokeProps} />
        </>
      )}

      {name === 'clipboard' && (
        <>
          <Rect x={8} y={2} width={8} height={4} rx={1} ry={1} {...strokeProps} />
          <Path
            d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
            {...strokeProps}
          />
        </>
      )}
    </Svg>
  );
}
