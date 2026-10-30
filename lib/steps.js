// The privacy clean-up checklist. Samsung gives no way to change these over the network,
// so the app guides you through the TV's own menus and logs each old value first.
// Menu paths are from a 2018 Tizen 4.0 TV; newer models word and place them differently.
const ADBLOCK_DNS = '94.140.14.14'; // AdGuard DNS

const STEPS = [
  { id: 'vis', kind: 'toggle', name: 'Viewing Information Services',
    path: 'Settings > Support > Terms & Policy > Viewing Information Services',
    target: 'Off', why: 'Stops the TV recognising what is on screen (from any input) and reporting it.' },
  { id: 'iba', kind: 'toggle', name: 'Interest-Based Advertisement',
    path: 'Settings > Support > Terms & Policy > Interest-Based Advertisement',
    target: 'Off', why: 'Stops ads being tailored from your viewing.' },
  { id: 'voice', kind: 'toggle', name: 'Voice Recognition Services',
    path: 'Settings > Support > Terms & Policy > Voice Recognition Services',
    target: 'Off', why: 'Skip this one if you use voice control.' },
  { id: 'terms-extra', kind: 'extras', name: 'Other optional items in Terms & Policy',
    path: 'Settings > Support > Terms & Policy',
    target: 'Off', why: 'Anything else optional about marketing, usage data or personalisation.' },
  { id: 'autohub', kind: 'toggle', name: 'Autorun Smart Hub',
    path: 'Settings > General > Smart Features > Autorun Smart Hub',
    target: 'Off', why: 'The TV stops opening the ad-filled Smart Hub every time it switches on.' },
  { id: 'autolast', kind: 'toggle', name: 'Autorun Last App',
    path: 'Settings > General > Smart Features > Autorun Last App',
    target: 'On', why: 'If Dock was the last thing open, it is what you see when the TV switches on.' },
  { id: 'tvplus', kind: 'toggle', name: 'Samsung TV Plus autostart',
    path: 'Settings > General > Smart Features (any option to start Samsung TV Plus automatically)',
    target: 'Off', why: 'Stops Samsung’s ad-supported channels opening by themselves.' },
  { id: 'ipv6', kind: 'toggle', name: 'IPv6',
    path: 'Settings > General > Network > Expert Settings > IPv6',
    target: 'Off', why: 'Makes the TV use the ad-blocking DNS below rather than your router’s IPv6 DNS.' },
  { id: 'dns', kind: 'dns', name: 'DNS',
    path: 'Settings > General > Network > Network Status > IP Settings > DNS setting',
    target: 'Enter manually: ' + ADBLOCK_DNS,
    why: 'Blocks Samsung’s ad and tracking servers for everything on the TV. It does not remove ads inside YouTube videos.' },
  { id: 'homebar', kind: 'homebar', name: 'Home bar tiles',
    path: 'Home > highlight a tile > press Down > Remove',
    target: 'Only the apps you use',
    why: 'Removes promoted tiles from the Home bar. Remove only takes the shortcut away; the app stays installed.' },
];

const WARNING = 'Leave “Smart Hub Terms & Conditions” and “Privacy Notice” agreed: refusing them turns off Netflix, YouTube and Spotify.';

module.exports = { STEPS, WARNING, ADBLOCK_DNS };
