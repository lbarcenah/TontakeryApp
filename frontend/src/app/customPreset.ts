import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';
export const MyPreset = definePreset(Lara, {
  semantic: {
    primary: {
      50: '#f3f7ed',
      100: '#e5eed8',
      200: '#cfdfb8',
      300: '#b0c690',
      400: '#8eac6b',
      500: '#648440',
      600: '#4d6c34',
      700: '#3d572c',
      800: '#334728',
      900: '#2d3d25',
      950: '#162111',
    },
  },
});
