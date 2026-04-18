// src/navigation/AppNavigator.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, StackNavigationOptions } from '@react-navigation/stack';
import { StatusBar } from 'react-native';
import { colors } from '../theme/theme';

import HomeScreen from '../screens/HomeScreen';
import SharingScreen from '../screens/SharingScreen';
import ControlScreen from '../screens/ControlScreen';
import ViewerScreen from '../screens/ViewerScreen';
import DiscoveryScreen from '../screens/DiscoveryScreen';

export type RootStackParamList = {
  Home: undefined;
  Sharing: undefined;
  Control: undefined;
  Viewer: {
    host: string;
    port: number;
    shareCode: string;
    deviceName?: string;
  };
  Discovery: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const screenOptions: StackNavigationOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: colors.bg },
  gestureEnabled: false,
  animationEnabled: true,
  cardStyleInterpolator: ({ current, layouts }) => ({
    cardStyle: {
      opacity: current.progress,
      transform: [
        {
          translateY: current.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [layouts.screen.height * 0.08, 0],
          }),
        },
      ],
    },
  }),
};

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.bg}
        translucent={false}
      />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={screenOptions}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Sharing" component={SharingScreen} />
        <Stack.Screen name="Control" component={ControlScreen} />
        <Stack.Screen name="Viewer" component={ViewerScreen} />
        <Stack.Screen name="Discovery" component={DiscoveryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
