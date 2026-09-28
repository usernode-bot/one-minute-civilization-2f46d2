// Daily Derby stories: why the winner won, why the player's pick won or
// lost, and the Race 8 personality verdict. Purely cosmetic. Everything
// here READS a derby the server already settled (GET /api/derby shape) and
// never changes speed, odds, winners, $NAIL or ranking, and nothing is ever
// sent back to the server.
//
// Choices are drawn from a PRNG seeded by the derby id plus every race's
// speeds, and replayed from race 1 on each call. The slate is fixed for the
// day, so the same player sees the same lines after a reload or on another
// device, and no line repeats within a derby (winner lines and pick lines
// are tracked separately). Nothing is stored.
//
// Snail names are not written here: lines use {name} and {winner}, and the
// page passes its own { id: name } map.
(function () {
  // A pick in the over 8x tier (+250, see nail-config.js) is a longshot. The
  // server sends each snail's tier points, so the odds rules stay there.
  var LONGSHOT_NAIL = 250;

  var CATEGORIES = [
    'romance', 'food', 'confusion', 'overconfidence', 'bad-luck', 'jealousy',
    'laziness', 'sleepiness', 'money', 'spectators', 'family', 'weather',
    'philosophy', 'rivalry', 'strange', 'absurd'
  ];

  // Lines are [category, when, text]. `when` is '' (any race) or a tag:
  // favourite (the snail had the race's top SPD), longshot (the snail was in
  // the +250 tier) or beatenByLongshot (lost lines: the winner was a
  // longshot). Pools: win ("Why X won"), lost ("Why X lost") and won ("Why
  // your pick won").
  var PERSONALITIES = {
    // 🥜 Simple, innocent, unexpectedly lucky.
    cycle_o: {
      traits: 'simple, innocent, unexpectedly lucky',
      win: [
        ['absurd', '', '{name} had no strategy. {name} just kept moving, and somehow everyone else made worse decisions.'],
        ['bad-luck', '', 'Every other snail hit a pebble at the same moment. {name} did not. That was the whole race.'],
        ['confusion', '', '{name} thought this was a queue for snacks and wanted to be first in line.'],
        ['food', '', 'Someone dropped a crumb just past the finish line. {name} has never moved with more purpose.'],
        ['strange', '', '{name} stayed in lane, kept head down, and accidentally became the fastest snail alive.'],
        ['spectators', '', 'A small child in the crowd cheered for {name} by name. Nobody had ever done that before.'],
        ['weather', '', 'A gentle breeze pushed from behind. {name} did not question it.'],
        ['family', '', '{name} promised Grandma Snail a medal, and nobody breaks a promise to Grandma.'],
        ['sleepiness', '', '{name} was sleepwalking in a straight line, which turned out to be an excellent racing technique.'],
        ['money', '', '{name} found a shiny coin on the track and ran to show someone. The someone was at the finish line.'],
        ['rivalry', '', 'The other five were busy glaring at each other. {name} simply went around the drama.'],
        ['strange', '', 'A four leaf clover was growing in {name}\'s lane. Luck did the rest.'],
        ['confusion', 'longshot', '{name} had the worst odds on the board and no idea what odds were. Blissful ignorance paid off.']
      ],
      lost: [
        ['food', '', '{name} found a crumb halfway down the track and decided this was a picnic now.'],
        ['confusion', '', '{name} ran the whole race perfectly. In the wrong direction.'],
        ['spectators', '', '{name} stopped to wave at everyone in the crowd. Individually.'],
        ['sleepiness', '', '{name} took a small nap at the halfway mark. It was a very good nap.'],
        ['family', '', '{name} spotted a cousin in the stands and stopped to catch up on family news.'],
        ['weather', '', 'A single raindrop landed next to {name}. {name} waited politely for it to finish.'],
        ['bad-luck', '', 'For once, the luck ran out. {name} tripped over absolutely nothing.'],
        ['romance', '', '{name} got a wink from a snail in row two and forgot how legs work. Snails do not have legs, which made it more confusing.'],
        ['philosophy', '', '{name} asked why everyone was in such a hurry. Nobody had a good answer, so {name} stopped.'],
        ['absurd', '', '{name} was carried off course by a very determined ant who had other plans.'],
        ['laziness', '', '{name} decided second place sounded relaxing. Then third. Then this.'],
        ['strange', 'beatenByLongshot', '{name} was beaten by {winner}, which surprised {name} almost as much as it surprised you.'],
        ['overconfidence', 'favourite', '{name} was the favourite and knew it, so {name} started signing autographs before the finish.']
      ],
      won: [
        ['money', '', '{name} never looked at the odds, and neither did you. Innocence wins again.'],
        ['spectators', '', 'You believed in {name}. {name} could feel it, mostly because you were staring very hard.'],
        ['confusion', '', '{name} does not know what happened either, but is very happy about it.'],
        ['absurd', '', '{name} had one job, forgot what it was, and did it anyway.'],
        ['philosophy', '', 'Your pick was simple, honest and lucky. Just like {name}.'],
        ['food', '', '{name} heard you cheering and would like a snack as a reward. Please bring a snack.']
      ]
    },

    // 🧇 Relaxed, philosophical, sometimes absent minded.
    drea: {
      traits: 'relaxed, philosophical, sometimes absent minded',
      win: [
        ['philosophy', '', '{name} realized the finish line is just the start line of something else, and wanted to see what.'],
        ['laziness', '', '{name} did not rush. Everyone else rushed and burned out by the second pebble.'],
        ['sleepiness', '', '{name} was half asleep, fully relaxed and somehow completely aerodynamic.'],
        ['confusion', '', '{name} forgot this was a race and simply went for a pleasant walk. It was a fast walk.'],
        ['weather', '', '{name} loves a light drizzle. The track was perfect for a thoughtful glide.'],
        ['food', '', '{name} was heading toward a lettuce leaf that happened to be past the finish line.'],
        ['strange', '', '{name} meditated before the start and reached the finish in a state of total calm, and also first.'],
        ['rivalry', '', 'The others argued about who was fastest. {name} politely went past while they debated.'],
        ['family', '', '{name}\'s mother always said slow and steady wins the race. For once, she was right.'],
        ['spectators', '', 'The crowd went quiet to hear {name} think. In that silence, {name} won.'],
        ['money', '', '{name} does not care about $NAIL at all, which is exactly why the $NAIL came to {name}.'],
        ['absurd', '', '{name} was reading a very short book while racing. It had a twist ending: {name} wins.'],
        ['overconfidence', 'favourite', '{name} was the favourite and refused to let it become stress. It became speed instead.']
      ],
      lost: [
        ['philosophy', '', '{name} stopped to ask if winning is truly winning. By the time an answer arrived, {winner} had won.'],
        ['sleepiness', '', '{name} closed both eyes for a moment of reflection. The moment lasted the whole race.'],
        ['confusion', '', '{name} forgot which way the finish was and chose the scenic route.'],
        ['laziness', '', '{name} decided the journey was more important than the destination. The destination disagreed.'],
        ['weather', '', 'The sun came out and {name} felt it would be rude not to bask.'],
        ['food', '', '{name} found a mushroom and needed a minute to think about it. Then ten more minutes.'],
        ['romance', '', '{name} wrote a poem for a snail in the stands. It was a long poem.'],
        ['spectators', '', 'Someone in the crowd asked {name} a deep question. {name} answered it fully.'],
        ['family', '', '{name} stopped to call home and tell everyone about the race. The race continued without {name}.'],
        ['absurd', '', '{name} was convinced the track was a circle and waited for it to come back around.'],
        ['money', '', '{name} spent the race wondering what money really is. The answer was: not this.'],
        ['strange', 'beatenByLongshot', '{name} watched {winner} win at long odds and simply said: interesting.'],
        ['overconfidence', 'favourite', '{name} was so sure of winning that there seemed no reason to actually try.']
      ],
      won: [
        ['laziness', '', '{name} did not try hard, and you did not think hard. Together you were unstoppable.'],
        ['philosophy', '', '{name} won while thinking about the meaning of shells. Imagine what happens with focus.'],
        ['sleepiness', '', 'You trusted the calm one. The calm one delivered, slowly, but first.'],
        ['weather', '', '{name} drifted forward like a leaf on a friendly breeze, and you rode the breeze too.'],
        ['confusion', '', '{name} forgot there were other snails. Honestly, that helped.'],
        ['rivalry', '', '{name} won without ever noticing there was competition. The competition noticed.']
      ]
    },

    // 🌰 Romantic, easily distracted, socially curious.
    evan: {
      traits: 'romantic, easily distracted, socially curious',
      win: [
        ['romance', '', '{name} spotted a special someone waiting at the finish line. Love found a new top speed.'],
        ['spectators', '', '{name} wanted to reach the crowd first for more fans. Charm is a powerful fuel.'],
        ['jealousy', '', '{name} saw a rival flirting with the snail {name} likes. Jealousy is extremely fast.'],
        ['money', '', '{name} promised a date that the winner buys dinner, and refuses to be broke on a date.'],
        ['family', '', '{name} wanted to impress a date\'s parents, who were sitting in row one.'],
        ['food', '', 'Someone at the finish was holding a heart shaped strawberry. {name} took that as a sign.'],
        ['weather', '', 'It was a misty, romantic morning and {name} was feeling poetic. Poetry, it turns out, moves quickly.'],
        ['confusion', '', '{name} thought the finish line was a wedding aisle and walked it with great purpose.'],
        ['rivalry', '', '{name} has an ex in this race. Winning was the only acceptable outcome.'],
        ['strange', '', '{name} was being chased by a love letter that blew onto the track.'],
        ['overconfidence', '', '{name} blew a kiss to the crowd at the start and could not let the crowd see a loss after that.'],
        ['sleepiness', '', '{name} had been dreaming of this moment all night and woke up ready.'],
        ['romance', 'longshot', 'Nobody gave {name} a chance. {name} loves a love story with a surprise ending.']
      ],
      lost: [
        ['romance', '', '{name} stopped to flirt with a snail passing by. Apparently romance had better odds today.'],
        ['spectators', '', '{name} saw someone cute in the audience. The race was immediately forgotten.'],
        ['romance', '', '{name} was writing a love letter mid race and needed to check how to spell forever.'],
        ['jealousy', '', '{name} saw {winner} getting all the attention and sulked instead of racing.'],
        ['food', '', '{name} stopped to share a strawberry with a new friend. Sharing takes time.'],
        ['family', '', '{name} spotted a date\'s grandmother in the stands and stopped to say a proper hello.'],
        ['confusion', '', '{name} followed a very attractive shell. It was not a snail. It was just a shell.'],
        ['weather', '', 'The light was perfect for a selfie. {name} took forty.'],
        ['money', '', '{name} spent the race trying to buy flowers from a vendor in the stands.'],
        ['philosophy', '', '{name} wondered if love is a race or a journey. {name} chose journey.'],
        ['absurd', '', '{name} got engaged halfway down the track. Congratulations are in order. $NAIL is not.'],
        ['strange', 'beatenByLongshot', '{name} lost to {winner}, which is fine, because {name} was busy thinking {winner} looked kind of charming.'],
        ['overconfidence', 'favourite', '{name} was the favourite and spent the lead drawing hearts on the track for fans.']
      ],
      won: [
        ['romance', '', '{name} stayed focused for once. Someone in the crowd must have been watching.'],
        ['romance', '', '{name} won to impress a crush. Your $NAIL is a happy side effect.'],
        ['philosophy', '', 'You backed love, and love showed up on time. Rare, but beautiful.'],
        ['spectators', '', '{name} ran straight to you after the finish, then kept going to someone cuter.'],
        ['strange', '', '{name} did not stop to flirt even once. Historians will study this race.'],
        ['family', '', '{name} thanks you for your support and would like your cousin\'s number.']
      ]
    },

    // 🥕 Impulsive, confident, slightly troublesome.
    lucas: {
      traits: 'impulsive, confident, slightly troublesome',
      win: [
        ['overconfidence', '', '{name} saw the finish line, remembered somewhere to be, and suddenly became extremely motivated.'],
        ['overconfidence', '', '{name} announced the win before the race started. Then made it true, just to be right.'],
        ['rivalry', '', '{name} stole the lane of the snail next door. Rude, but very effective.'],
        ['money', '', '{name} bet a friend a whole lettuce on this race and cannot afford to lose a lettuce.'],
        ['food', '', '{name} smelled carrot cake at the finish line and simply took off.'],
        ['jealousy', '', '{name} could not stand the idea of anyone else getting the trophy photo.'],
        ['spectators', '', 'The crowd booed {name} at the start. {name} took that as fuel.'],
        ['strange', '', '{name} took a shortcut nobody knew existed. The judges are still investigating.'],
        ['weather', '', 'A gust of wind came along and {name} rode it like it was planned. It was not planned.'],
        ['family', '', '{name}\'s little sister was watching, and {name} does not lose in front of family.'],
        ['absurd', '', '{name} started the race going backwards to show off, then turned around and won anyway.'],
        ['confusion', '', '{name} misheard GO as GO FAST and took it as a personal instruction.'],
        ['overconfidence', 'favourite', '{name} was the favourite and acted like it. For once, the confidence was justified.']
      ],
      lost: [
        ['overconfidence', '', '{name} started celebrating at the halfway mark. The race did not stop to celebrate with {name}.'],
        ['rivalry', '', '{name} spent the race trying to start a fight with {winner}. {winner} was too busy winning.'],
        ['money', '', '{name} stopped to argue with a bookie about the odds.'],
        ['food', '', '{name} raided a carrot stand in the stands. It was worth it, says {name}.'],
        ['strange', '', '{name} took a shortcut that turned out to be a very long cut.'],
        ['spectators', '', '{name} turned around to take a bow before crossing the line. {winner} did not take a bow.'],
        ['jealousy', '', '{name} was so annoyed by {winner}\'s lead that {name} stopped to complain to the judges.'],
        ['confusion', '', '{name} ran in whatever direction felt exciting. None of them were the finish line.'],
        ['bad-luck', '', '{name} got a warning for trouble at the start and spent the race in the naughty corner.'],
        ['laziness', '', '{name} was so sure of an easy win that {name} took the second half off.'],
        ['weather', '', '{name} tried to race a raindrop instead of the other snails. The raindrop won too.'],
        ['absurd', '', '{name} tried to jump the finish line in one heroic leap. Snails cannot leap.'],
        ['rivalry', 'beatenByLongshot', '{name} still believes {winner} cheated. There is no evidence. {name} does not care.']
      ],
      won: [
        ['overconfidence', '', '{name} ignored everyone, ignored the odds, and somehow that was the correct decision.'],
        ['rivalry', '', '{name} won and would like everyone to know it was never in doubt. It was in a lot of doubt.'],
        ['strange', '', 'You backed trouble, and trouble paid out.'],
        ['spectators', '', '{name} is taking a victory lap. Nobody asked for a victory lap.'],
        ['money', '', '{name} would like a percentage of your $NAIL. Please do not agree to this.'],
        ['jealousy', '', 'The other snails are furious. {name} has never been happier.']
      ]
    },

    // 🪨 Serious looking, constantly in ridiculous situations.
    scradio: {
      traits: 'serious looking, constantly in ridiculous situations',
      win: [
        ['strange', '', '{name} looked extremely serious the whole time, mostly because a beetle was riding on the shell and steering.'],
        ['absurd', '', '{name} was chased by a runaway garden hose. {name} did not look scared. {name} looked focused.'],
        ['weather', '', 'A tiny whirlwind swept through the track and placed {name} neatly past the finish.'],
        ['rivalry', '', '{name} gave the other snails a very serious look at the start. Several of them went home.'],
        ['confusion', '', '{name} thought the finish line was a crack in the pavement that needed inspecting. Professionally.'],
        ['money', '', '{name} had signed a serious business contract to win this race. {name} honours contracts.'],
        ['food', '', 'A lettuce leaf fell from the sky and landed ahead of {name}. {name} pursued it with dignity.'],
        ['family', '', '{name}\'s entire family was holding a banner. {name} could not face them otherwise.'],
        ['spectators', '', 'A pigeon in the crowd had bet on {name}. {name} did not want trouble with the pigeon.'],
        ['sleepiness', '', '{name} was actually asleep with a very serious face. The track was downhill.'],
        ['philosophy', '', '{name} contemplated the sheer seriousness of racing and found it deeply motivating.'],
        ['bad-luck', '', '{name} had terrible luck all morning. The universe owed {name} one, and paid today.'],
        ['overconfidence', 'longshot', '{name} was a longshot and took it as an insult. A very serious insult.']
      ],
      lost: [
        ['absurd', '', '{name} was mistaken for a rock, and a small bird sat on {name} for the rest of the race.'],
        ['strange', '', '{name} got stuck in a very serious staring contest with a garden gnome. The gnome won.'],
        ['confusion', '', '{name} was handed a clipboard by mistake and spent the race inspecting the track.'],
        ['weather', '', 'A puddle appeared in {name}\'s lane. {name} treated it as a lake and went around it properly.'],
        ['bad-luck', '', 'A leaf landed over {name}\'s eyes. {name} kept a serious face and raced straight into the fence.'],
        ['spectators', '', 'A photographer asked {name} to pose. {name} takes portraits very seriously.'],
        ['family', '', '{name}\'s aunt was in the crowd with sandwiches. Aunts cannot be ignored.'],
        ['money', '', '{name} stopped to file a serious complaint about ticket prices.'],
        ['sleepiness', '', '{name} looked focused but was actually asleep. Nobody could tell, including {name}.'],
        ['jealousy', '', '{name} saw {winner} wearing a better racing stripe and needed a moment.'],
        ['rivalry', '', '{name} was busy glaring at a rival snail. The rival was glaring back. Neither won.'],
        ['absurd', '', '{name} was carried off by a very small balloon for about four minutes. {name} would prefer not to discuss it.'],
        ['overconfidence', 'favourite', '{name} was the favourite and paused to give a serious speech about responsibility.']
      ],
      won: [
        ['strange', '', '{name} won with a straight face and has not smiled since. This is joy.'],
        ['philosophy', '', '{name} did not have fun. {name} simply won, which is better.'],
        ['bad-luck', '', 'Something ridiculous almost happened to {name}, but it happened to everyone else instead.'],
        ['money', '', 'You made a serious choice, and it made serious $NAIL.'],
        ['spectators', '', '{name} crossed the finish line and nodded once. That is a celebration for {name}.'],
        ['absurd', '', 'A tiny traffic cone fell on the track and {name} simply wore it. Nothing stops {name}.']
      ]
    },

    // 🍪 Confused, eccentric, easily fascinated.
    snait: {
      traits: 'confused, eccentric, easily fascinated',
      win: [
        ['confusion', '', '{name} was chasing a butterfly and did not notice the race. The butterfly flew past the finish.'],
        ['strange', '', '{name} became fascinated by the finish line tape and had to get a closer look. Immediately.'],
        ['absurd', '', '{name} invented a new way of sliding mid race. Nobody understands it, including {name}.'],
        ['food', '', '{name} was curious what the winner\'s lettuce tasted like. Now {name} knows.'],
        ['weather', '', '{name} was racing the shadow of a cloud. The cloud was very fast.'],
        ['philosophy', '', '{name} wondered what is beyond the finish line. There was only one way to find out.'],
        ['spectators', '', 'Someone in the crowd was wearing a shiny hat. {name} simply had to get closer.'],
        ['money', '', '{name} saw a coin glinting past the finish line and forgot everything else.'],
        ['family', '', '{name} thought an uncle was waiting at the end. It was a pinecone. Still a win.'],
        ['rivalry', '', '{name} did not know there was a rivalry, which made {name} the only snail not distracted by it.'],
        ['sleepiness', '', '{name} dreamed the whole race, and in the dream {name} won. Apparently dreams count.'],
        ['jealousy', '', 'The other snails were jealous of {name}\'s strange glow. {name} had eaten something unusual.'],
        ['confusion', 'longshot', '{name} had terrible odds and thought odds were a type of snack. Blissful.']
      ],
      lost: [
        ['confusion', '', '{name} became fascinated by a leaf and studied it for the entire race.'],
        ['strange', '', '{name} discovered the track has seventeen kinds of dust and needed to count them all.'],
        ['absurd', '', '{name} tried racing sideways as an experiment. The experiment is ongoing.'],
        ['food', '', '{name} found a flower that smelled like cookies and had to investigate.'],
        ['weather', '', '{name} stopped to study how a raindrop works. It fell. Then another one fell.'],
        ['philosophy', '', '{name} asked where the finish line leads, then went to look for the answer somewhere else.'],
        ['spectators', '', '{name} got stuck admiring someone\'s umbrella in the crowd. It had stripes.'],
        ['family', '', '{name} started telling a story about a great uncle who raced once. The story had no ending.'],
        ['money', '', '{name} thought $NAIL was a real nail and went looking for a hammer.'],
        ['sleepiness', '', '{name} fell asleep while trying to count the other snails. There were five.'],
        ['confusion', '', '{name} ran the race. A different race. Somewhere nearby.'],
        ['bad-luck', 'beatenByLongshot', '{name} still has not realized the race is over, or that {winner} won it.'],
        ['overconfidence', 'favourite', '{name} was the favourite and got distracted wondering what a favourite is.']
      ],
      won: [
        ['confusion', '', '{name} won and is now curious what winning is. Please explain gently.'],
        ['strange', '', '{name} followed something shiny, and the shiny thing was the finish line.'],
        ['absurd', '', '{name} does not know how it happened. You do not either. It counts.'],
        ['philosophy', '', '{name} won while inventing a brand new direction called forward.'],
        ['spectators', '', 'You picked the weird one, and the weird one delivered.'],
        ['jealousy', '', 'The sensible snails are very upset that {name} won. {name} is looking at a pebble.']
      ]
    }
  };

  var GENERIC = {
    win: [
      ['absurd', '', '{name} was simply the snail that got there first. Nobody can argue with that logic.'],
      ['bad-luck', '', 'The rest of the field had a very bad day all at once. {name} had a normal day.'],
      ['confusion', '', '{name} was the only snail who actually read the rules. The rules said go that way.'],
      ['food', '', '{name} heard the finish line had free lettuce. The finish line did not have free lettuce.'],
      ['weather', '', 'The wind picked a favourite today, and it picked {name}.'],
      ['family', '', '{name} had the whole family in the stands, and all of them were yelling directions.'],
      ['spectators', '', '{name} fed off the crowd. Not literally. Mostly not literally.'],
      ['rivalry', '', '{name} had a score to settle with the entire field and settled all of it at once.'],
      ['money', '', '{name} has bills to pay. Racing is the only job {name} has.'],
      ['sleepiness', '', 'Everyone else stayed up late. {name} got a full night of sleep, and it showed.'],
      ['laziness', '', '{name} did the bare minimum, which today was more than everyone else.'],
      ['philosophy', '', '{name} believed in winning so strongly that reality gave up and agreed.'],
      ['romance', '', '{name} was trying to impress someone special, and it absolutely worked.'],
      ['jealousy', '', '{name} was tired of watching everyone else win and simply decided it was time.'],
      ['overconfidence', '', '{name} was confident. Wildly, unreasonably confident. And for once, correct.'],
      ['strange', '', 'A mysterious cloud of glitter blew across the track, and {name} came out of it winning.'],
      ['absurd', '', '{name} was stuck to a skateboard for the last few inches. The judges allowed it.'],
      ['bad-luck', '', 'Four snails slipped on the same wet leaf. The fifth stopped to help. {name} kept going.'],
      ['confusion', '', '{name} thought the race was already over and tried to catch up. Catching up was winning.'],
      ['food', '', '{name} skipped breakfast and was racing toward lunch.'],
      ['weather', '', 'The sun came out right over {name}\'s lane like a spotlight. {name} took the hint.'],
      ['spectators', '', 'A very loud grandpa in the crowd was cheering only for {name}. It worked.'],
      ['family', '', '{name} promised the kids a trophy for the shelf. Parents keep promises.'],
      ['money', '', '{name} heard a rumour about a bonus for first place. There is no bonus, but here we are.'],
      ['philosophy', '', '{name} became one with the track. The track apparently wanted {name} to win.'],
      ['rivalry', '', '{name} has been rivals with a certain shadow for years. Today, {name} finally won.'],
      ['sleepiness', '', '{name} was too sleepy to get distracted, which turned out to be a superpower.'],
      ['romance', '', '{name} got a good luck kiss at the start. That kiss had a lot of speed in it.'],
      ['laziness', '', '{name} found the laziest possible line through the course. It was also the shortest.'],
      ['spectators', 'longshot', 'Nobody bet on {name}. {name} took that as a personal challenge.'],
      ['money', 'longshot', 'The odds said no. {name} does not speak the language of odds.'],
      ['strange', 'favourite', '{name} was the favourite, and for once, the favourite did favourite things.'],
      ['philosophy', 'favourite', '{name} had the best speed on the card and actually used it, which is rare in this sport.']
    ],
    lost: [
      ['bad-luck', '', '{name} hit the only pebble on the track. Twice.'],
      ['confusion', '', '{name} lined up facing the crowd and spent the race looking for a finish line back there.'],
      ['food', '', '{name} passed a lettuce leaf and simply could not leave it there alone.'],
      ['laziness', '', '{name} decided to save energy for the next race. And the one after that.'],
      ['sleepiness', '', '{name} took a quick nap. It was not quick.'],
      ['weather', '', 'The wind was blowing the wrong way, and {name} is very light.'],
      ['spectators', '', '{name} stopped to sign an autograph for a fan. The fan wanted three.'],
      ['family', '', '{name}\'s mum called during the race. You do not ignore Mum.'],
      ['money', '', '{name} stopped to pick up a coin. It was a bottle cap. The race was gone.'],
      ['romance', '', '{name} caught the eye of a snail in the stands and forgot what a race was.'],
      ['jealousy', '', '{name} was so busy being jealous of {winner}\'s shell that the race slipped by.'],
      ['overconfidence', '', '{name} slowed down to enjoy the lead. There was no lead.'],
      ['philosophy', '', '{name} began to wonder why anyone races at all. A fair question, but not during a race.'],
      ['rivalry', '', '{name} was focused on beating one specific rival. The rival also lost. Nobody is happy.'],
      ['strange', '', 'A passing bird briefly mistook {name} for a snack, and {name} needed a moment to calm down.'],
      ['absurd', '', '{name} got stuck to a sticker that said SLOW. It was very accurate.'],
      ['bad-luck', '', 'A puddle appeared in {name}\'s lane. Only in {name}\'s lane.'],
      ['confusion', '', '{name} followed the snail in front, who was also lost.'],
      ['food', '', '{name} stopped for a snack, then a second snack, then a nap to digest.'],
      ['weather', '', '{name} stopped to shelter from rain that was not falling.'],
      ['spectators', '', '{name} spotted a camera and paused to pose. The camera was pointed at {winner}.'],
      ['laziness', '', '{name} decided second place was a lot less effort. {name} did not finish second either.'],
      ['sleepiness', '', '{name} yawned at the start and never really recovered.'],
      ['family', '', '{name}\'s little brother was in the stands and needed help finding a seat.'],
      ['money', '', '{name} tried to negotiate an appearance fee mid race.'],
      ['jealousy', '', '{name} saw {winner} pulling ahead and stopped to sulk about it. Sulking is slow.'],
      ['absurd', '', '{name} was blown off course by a very small but very dramatic sneeze from the crowd.'],
      ['strange', '', 'A mysterious fog rolled in, but only around {name}. It rolled away right after the race.'],
      ['romance', '', '{name} spent the race composing a love song. The chorus was very long.'],
      ['philosophy', '', '{name} decided every snail is a winner in its own way. The scoreboard disagreed.'],
      ['rivalry', 'beatenByLongshot', '{name} lost to {winner}, of all snails. {name} will be thinking about this for weeks.'],
      ['confusion', 'beatenByLongshot', '{winner} came from nowhere. {name} is still looking for where nowhere is.'],
      ['overconfidence', 'favourite', '{name} was the favourite and got nervous about it. Nerves are very slow.'],
      ['confusion', 'favourite', '{name} had the speed but not the attention span.']
    ],
    won: [
      ['overconfidence', '', 'You picked {name}, {name} won, and now you both think you are geniuses.'],
      ['money', '', '{name} came through, and so did your $NAIL.'],
      ['spectators', '', 'Your cheering was loud enough to help. Probably. Let\'s say it was.'],
      ['philosophy', '', 'You believed in {name}. Belief has never been this profitable.'],
      ['absurd', '', '{name} won and nobody is more surprised than {name}. Except maybe you.'],
      ['family', '', '{name} would like to thank you, the fans, and {name}\'s mum, in that order.'],
      ['strange', '', 'Somewhere, a fortune teller predicted this. You were that fortune teller.'],
      ['food', '', '{name} is celebrating with an entire lettuce. You are invited.'],
      ['weather', '', 'The stars aligned, the wind agreed and {name} delivered.'],
      ['rivalry', '', '{name} and you, against the world. The world lost.'],
      ['bad-luck', '', 'Bad luck took the day off, and you picked exactly the right day.'],
      ['romance', '', 'It was love at first pick, and {name} did not let you down.'],
      ['overconfidence', 'longshot', 'You backed a longshot and it came home. Tell everyone. Tell them twice.'],
      ['food', 'favourite', 'You backed the favourite and the favourite won. Sensible, and delicious.']
    ]
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Every line gets a stable id: pool.snail.NN, or pool.any.NN.
  function build(pool, owner, raw) {
    return raw.map(function (l, i) {
      return { id: pool + '.' + owner + '.' + pad(i + 1), category: l[0], when: l[1] || null, text: l[2], own: owner !== 'any' };
    });
  }

  var LIBRARY = { own: {}, any: {} };
  ['win', 'lost', 'won'].forEach(function (pool) {
    LIBRARY.any[pool] = build(pool, 'any', GENERIC[pool]);
    Object.keys(PERSONALITIES).forEach(function (id) {
      LIBRARY.own[id] = LIBRARY.own[id] || {};
      LIBRARY.own[id][pool] = build(pool, id, PERSONALITIES[id][pool]);
    });
  });

  // FNV-1a into mulberry32: small, fast and the same in every browser.
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function rng(seed) {
    var a = hash(seed);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fixed for the day: the slate never changes once created.
  function seedOf(derby) {
    return String(derby.derbyId) + '|' + derby.races.map(function (r) {
      return r.snails.map(function (s) { return s.id + ':' + s.spd; }).join(',');
    }).join('/');
  }

  function snailIn(race, id) {
    for (var i = 0; i < race.snails.length; i++) if (race.snails[i].id === id) return race.snails[i];
    return null;
  }

  function isFavourite(race, id) {
    var s = snailIn(race, id);
    if (!s) return false;
    var max = 0;
    race.snails.forEach(function (x) { if (x.spd > max) max = x.spd; });
    return s.spd === max;
  }

  function isLongshot(race, id) {
    var s = snailIn(race, id);
    return !!s && s.nail >= LONGSHOT_NAIL;
  }

  function fits(line, tags) {
    return !line.when || !!tags[line.when];
  }

  // Weighted draw: a snail's own lines count double against generic ones.
  // If nothing fits, relax the category rule, then `when`, then allow a
  // reuse (unreachable in eight races; the tests check it).
  function draw(lines, used, tags, avoidCategory, rand) {
    var tests = [
      function (l) { return !used[l.id] && fits(l, tags) && l.category !== avoidCategory; },
      function (l) { return !used[l.id] && fits(l, tags); },
      function (l) { return !used[l.id]; },
      function () { return true; }
    ];
    for (var t = 0; t < tests.length; t++) {
      var pool = lines.filter(tests[t]);
      if (!pool.length) continue;
      var total = 0;
      pool.forEach(function (l) { total += l.own ? 2 : 1; });
      var roll = rand() * total;
      for (var i = 0; i < pool.length; i++) {
        roll -= pool[i].own ? 2 : 1;
        if (roll < 0) return pool[i];
      }
      return pool[pool.length - 1];
    }
    return null;
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }

  function nameOf(names, id) {
    return (names && names[id]) || id;
  }

  function poolFor(pool, id) {
    var own = (LIBRARY.own[id] && LIBRARY.own[id][pool]) || [];
    return own.concat(LIBRARY.any[pool]);
  }

  // { [raceNumber]: { winnerLine, pickLine, pickWon } } for resolved races.
  function storiesFor(derby, names) {
    var out = {};
    if (!derby || !derby.races) return out;
    var rand = rng(seedOf(derby) + '|stories');
    var usedWin = {};
    var usedPick = {};
    derby.races.forEach(function (race) {
      var res = race.result;
      if (!res) return;
      var vars = { name: nameOf(names, res.winner), winner: nameOf(names, res.winner) };
      var winTags = { favourite: isFavourite(race, res.winner), longshot: isLongshot(race, res.winner) };
      var w = draw(poolFor('win', res.winner), usedWin, winTags, null, rand);
      usedWin[w.id] = true;

      var pickPool = res.won ? 'won' : 'lost';
      var pickTags = {
        favourite: isFavourite(race, res.pick),
        longshot: isLongshot(race, res.pick),
        beatenByLongshot: !res.won && isLongshot(race, res.winner)
      };
      var p = draw(poolFor(pickPool, res.pick), usedPick, pickTags, w.category, rand);
      usedPick[p.id] = true;

      out[race.raceNumber] = {
        winnerLine: fill(w.text, vars),
        pickLine: fill(p.text, { name: nameOf(names, res.pick), winner: vars.winner }),
        pickWon: !!res.won,
        winnerLineId: w.id,
        pickLineId: p.id
      };
    });
    return out;
  }

  // The finish order for the race animation: the real winner first, the rest
  // by a seeded, speed weighted shuffle. Cosmetic only.
  function finishOrder(derby, raceNumber, winner) {
    var race = derby.races[raceNumber - 1];
    var rand = rng(seedOf(derby) + '|anim|' + raceNumber);
    var rest = race.snails.filter(function (s) { return s.id !== winner; }).slice();
    var order = [winner];
    while (rest.length) {
      var total = 0;
      rest.forEach(function (s) { total += s.spd; });
      var roll = rand() * total;
      var k = rest.length - 1;
      for (var i = 0; i < rest.length; i++) {
        roll -= rest[i].spd;
        if (roll < 0) { k = i; break; }
      }
      order.push(rest[k].id);
      rest.splice(k, 1);
    }
    return order;
  }

  // Race 8 verdict. Main lines by label; small counts are written as words.
  var LABELS = {
    loyalist: { label: 'The Loyalist', lines: [
      '{TopCount} {top} picks out of eight. You found your snail and you are not taking questions.',
      'You picked {top} {topCount} times. Other snails exist, but you have chosen not to see them.',
      '{TopCount} races, one snail. You and {top} are basically a team now.'
    ] },
    heartbreak: { label: 'The Loyalist', lines: [
      'You kept choosing {top} even when {top} kept disappointing you. That\'s either loyalty or a very complicated relationship.',
      '{TopCount} {top} picks and barely anything back. You are the most loyal fan {top} does not deserve.',
      'You stood by {top} through every loss. {top} did not stand by you, but it\'s the thought that counts.'
    ] },
    gambler: { label: 'The Gambler', lines: [
      'You kept choosing the longshots. You either have incredible faith or absolutely no respect for probability.',
      '{LongPicks} longshot picks. You did not come here to win. You came here to have a story.',
      'You looked at the odds board and went straight for the bottom. Every time. Bold.'
    ] },
    underdog: { label: 'The Underdog Believer', lines: [
      'You backed the underdogs, and the underdogs showed up. Nobody saw it coming except you.',
      '{LongPicks} longshot picks, and it actually paid off. Please do not tell the favourites.',
      'You believe in the little snail, and today the little snail believed back.'
    ] },
    statistician: { label: 'The Statistician', lines: [
      'You always picked the fastest looking snail. You believe in evidence. Boring, but occasionally profitable.',
      '{FavPicks} favourite picks. You read the form, trusted the numbers and made it look like homework.',
      'Your strategy was simple: pick the best speed. Your snails respected the spreadsheet.'
    ] },
    favouriteChaser: { label: 'The Favourite Chaser', lines: [
      'You kept backing the fastest snail, and the fastest snail kept finding new ways to lose. Science is hard.',
      '{FavPicks} favourite picks and not much to show for it. The numbers lied, and you believed them.',
      'You chased the favourites all day. The favourites were apparently running from you.'
    ] },
    chaos: { label: 'The Chaos Agent', lines: [
      'You picked six different snails across eight races. Strategy was clearly invited, but never showed up.',
      'Every snail got a turn. You were not betting, you were running a fairness program.',
      'Six snails, eight races, zero pattern. You are a mystery even to the snails.'
    ] },
    romantic: { label: 'The Romantic', lines: [
      '{TopCount} {top} picks. At this point, you\'re not betting on snails. You\'re looking for love.',
      'You picked {top} {topCount} times. You seem to have a weakness for romance, even when romance is clearly slowing down.',
      '{TopCount} {top} picks. The racing was optional. The romance was not.'
    ] },
    switcher: { label: 'The Serial Snail Switcher', lines: [
      'You switched snails after every single race. Commitment is clearly something that happens to other people.',
      'Seven switches in eight races. You treat snails like browser tabs.',
      'A new snail every race. You were not picking winners. You were speed dating.'
    ] },
    playboy: { label: 'The Playboy', lines: [
      'Five different snails in eight races. You like to keep your options open.',
      'You spread your affection across five snails. Each of them thinks they were special.',
      'Five snails, eight races. You are a heartbreaker with a very busy schedule.'
    ] },
    contrarian: { label: 'The Contrarian', lines: [
      'You never once picked the fastest snail. If everyone goes left, you go somewhere else entirely.',
      'Zero favourite picks. You looked at the obvious choice and said: absolutely not.',
      'You avoided the favourites all day. The favourites are hurt, but they will recover.'
    ] },
    unclear: { label: 'The Completely Unclear Strategy', lines: [
      'You picked {unique} different snails and switched {switchesTimes}. Strategy was invited, but it got lost on the way.',
      'We watched all eight races and still cannot tell what your plan was. Neither can you.',
      'Your picks followed a pattern that only you can see. Possibly not even you.'
    ] }
  };

  // Per snail labels for a most picked snail with three or more picks.
  var SNAIL_LABELS = {
    evan: { label: 'The {top} Admirer', lines: [
      'Three {top} picks. At this point, you\'re not here for the racing. You\'re here for love.',
      'You picked {top} three times. Somewhere in the stands, a romance novel is being written about you.',
      'Three {top} picks. You clearly enjoy a snail who stops to smell the roses, and the other snails.'
    ] },
    lucas: { label: 'The {top} Loyalist', lines: [
      'You picked {top} {topCount} times. You like a snail with confidence and questionable decisions. Relatable.',
      '{TopCount} {top} picks. Trouble keeps finding you, mostly because you keep picking it.',
      'You trusted {top} again and again. Impulsive, confident and slightly chaotic. The snail too.'
    ] },
    snait: { label: 'The {top} Enthusiast', lines: [
      '{TopCount} {top} picks. You clearly enjoy the snail who gets lost looking at leaves.',
      'You picked {top} {topCount} times. Your strategy, like {top}, was fascinated by something nobody else could see.',
      'You kept backing {top}. You seem to believe confusion is just genius that has not arrived yet.'
    ] },
    drea: { label: 'The {top} Philosopher', lines: [
      'You picked {top} more than anyone else. You seem comfortable making decisions at the same speed {top} runs.',
      '{TopCount} {top} picks. You are not racing. You are on a journey of inner calm.',
      'You kept choosing {top}. Relaxed, thoughtful and occasionally asleep. A lifestyle, not a strategy.'
    ] },
    scradio: { label: 'The {top} Defender', lines: [
      'You trusted {top} repeatedly. You appear to enjoy making serious decisions that occasionally make absolutely no sense.',
      '{TopCount} {top} picks. You like a snail with a straight face and a very strange life.',
      'You kept defending {top}\'s honour. {top} appreciates it, very seriously.'
    ] },
    cycle_o: { label: 'The {top} Believer', lines: [
      'You kept picking {top}. You don\'t need a strategy. You just believe in the little snail.',
      '{TopCount} {top} picks. Simple choices, simple snail, surprisingly big heart.',
      'You backed {top} {topCount} times. Luck is a strategy if you believe hard enough.'
    ] }
  };

  // Closing lines: how it went. First matching bucket wins.
  var CLOSINGS = {
    zero: [
      'Zero wins, zero $NAIL, and a truly heroic amount of optimism.',
      'Not a single win today. The snails would like to apologize, but they are busy napping.',
      'No wins at all. On the bright side, your score has nowhere to go but up.'
    ],
    big: [
      '{WinsPhrase} out of eight and {score} $NAIL. The snails are starting to worry about you.',
      '{WinsPhrase} and {score} $NAIL. Whatever you are doing, the leaderboard has noticed.'
    ],
    surprise: [
      '{WinsPhrase} out of eight, including a longshot nobody saw coming. You will be talking about that one.',
      'Not many wins, but a longshot came through for you, which is worth double in bragging rights.'
    ],
    high: [
      '{score} $NAIL. The judgement is playful, but that score is serious.',
      '{WinsPhrase} and {score} $NAIL. Somewhere, a snail is writing your name in slime.'
    ],
    middle: [
      '{WinsPhrase} out of eight, which romance would call a promising start.',
      '{WinsPhrase} out of eight and {score} $NAIL. Respectable, honest and slightly slimy.',
      '{WinsPhrase} and {score} $NAIL. The snails respect you. Mostly.'
    ]
  };

  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  function word(n) { return WORDS[n] || String(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function winsPhrase(n) { return n === 0 ? 'no wins' : n === 1 ? 'one win' : word(n) + ' wins'; }
  function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : word(n) + ' times'; }

  function metricsOf(derby) {
    var counts = {};
    derby.races[0].snails.forEach(function (s) { counts[s.id] = 0; });
    var m = { counts: counts, favPicks: 0, longPicks: 0, wins: 0, losses: 0, longWins: 0, switches: 0, score: 0 };
    var prev = null;
    derby.races.forEach(function (race) {
      var res = race.result;
      counts[res.pick] = (counts[res.pick] || 0) + 1;
      var fav = isFavourite(race, res.pick);
      var lng = isLongshot(race, res.pick);
      if (fav) m.favPicks++;
      if (lng) m.longPicks++;
      if (res.won) { m.wins++; if (lng) m.longWins++; } else m.losses++;
      if (prev !== null && prev !== res.pick) m.switches++;
      prev = res.pick;
      m.score += res.nail || 0;
    });
    var ids = Object.keys(counts);
    m.unique = ids.filter(function (id) { return counts[id] > 0; }).length;
    m.topCount = 0;
    ids.forEach(function (id) { if (counts[id] > m.topCount) m.topCount = counts[id]; });
    var tops = ids.filter(function (id) { return counts[id] === m.topCount; });
    m.top = tops.length === 1 ? tops[0] : null;
    m.topWins = m.top ? derby.races.filter(function (r) { return r.result.pick === m.top && r.result.won; }).length : 0;
    return m;
  }

  function labelKey(m) {
    if (m.topCount >= 6) return m.topWins <= 1 ? 'heartbreak' : 'loyalist';
    if (m.longPicks >= 5) return m.longWins >= 2 ? 'underdog' : 'gambler';
    if (m.favPicks >= 6) return m.wins >= 3 ? 'statistician' : 'favouriteChaser';
    if (m.unique === 6) return 'chaos';
    if (m.top && m.topCount >= 3 && SNAIL_LABELS[m.top]) {
      if (m.top === 'evan' && m.topCount >= 4) return 'romantic';
      return 'snail:' + m.top;
    }
    if (m.switches === 7) return 'switcher';
    if (m.unique === 5) return 'playboy';
    if (m.favPicks === 0) return 'contrarian';
    return 'unclear';
  }

  function closingKey(m) {
    if (m.wins === 0) return 'zero';
    if (m.wins >= 5) return 'big';
    if (m.longWins >= 1 && m.wins <= 2) return 'surprise';
    if (m.score >= 1000) return 'high';
    return 'middle';
  }

  // { counts, key, label, text, metrics } once every race is resolved.
  function summaryFor(derby, names) {
    if (!derby || !derby.races || !derby.races.length) return null;
    if (derby.races.some(function (r) { return !r.result; })) return null;
    var m = metricsOf(derby);
    var key = labelKey(m);
    var entry = key.indexOf('snail:') === 0 ? SNAIL_LABELS[key.slice(6)] : LABELS[key];
    var close = closingKey(m);
    var rand = rng(seedOf(derby) + '|summary');
    var main = entry.lines[Math.floor(rand() * entry.lines.length)];
    var end = CLOSINGS[close][Math.floor(rand() * CLOSINGS[close].length)];
    var vars = {
      top: m.top ? nameOf(names, m.top) : '',
      topCount: word(m.topCount), TopCount: cap(word(m.topCount)),
      unique: word(m.unique),
      favPicks: word(m.favPicks), FavPicks: cap(word(m.favPicks)),
      longPicks: word(m.longPicks), LongPicks: cap(word(m.longPicks)),
      switchesTimes: times(m.switches),
      winsPhrase: winsPhrase(m.wins), WinsPhrase: cap(winsPhrase(m.wins)),
      score: m.score
    };
    return {
      counts: m.counts,
      key: key,
      closing: close,
      label: fill(entry.label, vars),
      text: fill(main, vars) + ' ' + fill(end, vars),
      metrics: m
    };
  }

  var api = {
    CATEGORIES: CATEGORIES,
    LIBRARY: LIBRARY,
    LABELS: LABELS,
    SNAIL_LABELS: SNAIL_LABELS,
    CLOSINGS: CLOSINGS,
    storiesFor: storiesFor,
    summaryFor: summaryFor,
    finishOrder: finishOrder
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.snailDerbyStories = api;
})();
