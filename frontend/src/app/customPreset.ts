import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';
export const MyPreset = definePreset(Lara, {
  semantic: {
    primary: {
      50: '#faf3ff',
      100: '#f0e0ff',
      200: '#e1c2ff',
      300: '#cd9bf8',
      400: '#b176f1',
      500: '#914cce',
      600: '#7436ac',
      700: '#60298f',
      800: '#512675',
      900: '#44215e',
      950: '#291039',
    },
  },
});
