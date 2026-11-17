// "Inspire me" prompt bank (also used when a prompter times out).
export const PROMPT_BANK = [
  'a sleepy corgi wearing a crown',
  'a rubber duck pirate captain',
  'a cactus playing the guitar',
  'a tiny dragon guarding a teacup',
  'a robot watering a flower',
  'a penguin on a skateboard',
  'a haunted vending machine',
  'an astronaut cat in a bathtub',
  'a mushroom house with a chimney',
  'a grumpy avocado',
  'a snail with a castle shell',
  'a toaster that is also a spaceship',
  'a frog knight with a sword',
  'a cheeseburger with wings',
  'a teapot octopus',
  'a sloth riding a rocket',
  'a retro boombox with eyes',
  'a lighthouse made of candy',
  'a hedgehog wearing sneakers',
  'a viking helmet full of popcorn',
];

export const randomPrompt = () => PROMPT_BANK[Math.floor(Math.random() * PROMPT_BANK.length)];
