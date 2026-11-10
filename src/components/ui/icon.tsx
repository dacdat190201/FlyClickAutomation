import type { ColorValue } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

/** Cross-platform icon set: SF Symbols on iOS, Material Symbols on Android/web. */
const ICONS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  target: { ios: 'scope', android: 'ads_click', web: 'ads_click' },
  text: { ios: 'text.viewfinder', android: 'document_scanner', web: 'document_scanner' },
  logs: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  error: { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' },
  timer: { ios: 'timer', android: 'timer', web: 'timer' },
  bolt: { ios: 'bolt.fill', android: 'bolt', web: 'bolt' },
} satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  color: ColorValue;
  size?: number;
};

export function Icon({ name, color, size = 22 }: IconProps) {
  return <SymbolView name={ICONS[name]} tintColor={color} size={size} />;
}
