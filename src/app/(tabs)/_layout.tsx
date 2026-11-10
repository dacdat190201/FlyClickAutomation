import { Tabs } from 'expo-router';

import { Icon, type IconName } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Trang chủ', icon: 'home' },
  { name: 'targets', title: 'Mục tiêu', icon: 'target' },
  { name: 'text', title: 'Văn bản', icon: 'text' },
  { name: 'logs', title: 'Lịch sử', icon: 'logs' },
  { name: 'settings', title: 'Cài đặt', icon: 'settings' },
];

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color }) => <Icon name={tab.icon} color={color} size={24} />,
          }}
        />
      ))}
    </Tabs>
  );
}
