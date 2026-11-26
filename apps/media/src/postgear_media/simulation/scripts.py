"""What is "said" in the generated sample videos, as scripts.

The generated samples carry tones, not speech, so their transcripts are
written here by hand and turned into word-timed files by
`build_transcripts.py` (`simulation/transcripts/<sample>.json`, committed; a
test fails when a file is stale). Every line is `(start second, text)`: its
words are laid out from that second at a talking pace, and a line must end
before the next one starts.

The scripts are written to give every later feature something real to find:

- sentences that stand on their own (the moment picker, hook titles);
- filler words (um, you know, like, basically) and pauses of two seconds and
  more (Remove Filler Words, Remove Silences);
- a few mild bad words (Bleep Bad Words: a workspace adds them to My Words)
  and, in the talk, two strong ones the default English list bleeps
  ("bullshit" at 15.5 s, "shitty" at 100.6 s; each replaced a word of the
  same length, so no other word moved);
- words the listener was unsure of, marked with a leading `~`;
- a silent 30 second block in the talk (the no-speech path);
- a stretch of Tamil in the stream (the Tamil font and whole-word highlight);
- in `two-speakers`, lines that sit exactly inside each speaker's turn from
  `packages/media-tools/fixtures/samples/plan.json`.

Nothing here is a real person's words.
"""

from __future__ import annotations

#: Words a second when a line gives no end.
PACE_WORDS_PER_SECOND = 2.7

Line = tuple[float, str]

# --- talk.mp4: 3 minutes, one speaker, "why I quit my job" -------------------------------
# Loud tone bursts in the sample: 30 to 32 s, 95 to 97 s, 150 to 151.5 s.
# Nothing is said from 120 to 150 s (a whole listening block of silence).
TALK: list[Line] = [
    (2.0, "Okay, so today I want to talk about the hardest decision I ever made."),
    (8.2, "Two years ago I quit my job with no plan at all."),
    (13.4, "Um, everybody told me it was a ~bullshit idea."),
    (17.6, "My manager said I would be back in six months."),
    (22.0, "My parents, you know, they did not talk to me for a week."),
    (30.2, "And honestly? I was terrified!"),
    (33.6, "But here is the thing nobody tells you about quitting."),
    (38.4, "The fear does not go away, you just get better at carrying it."),
    (44.6, "So, like, the first month I did basically nothing."),
    (49.8, "I slept late, I watched videos, I felt like a complete ~fraud."),
    (56.4, "Then one morning I wrote down three things I was actually good at."),
    (63.0, "Teaching, writing, and explaining hard ideas simply."),
    (68.2, "That list became my whole business."),
    (72.4, "Here is tip number one: start before you feel ready."),
    (78.0, "You will never feel ready, and that is completely normal."),
    (83.6, "Tip number two: tell people what you are doing, out loud."),
    (89.4, "My first three clients came from one honest post."),
    (95.2, "One post! That is all it took!"),
    (99.0, "Tip number three is the shitty one: track your money every single week."),
    (106.4, "Um, I did not, and I almost ran out in month four."),
    (112.0, "That was the scariest damn week of my life."),
    (152.0, "So, would I do it again?"),
    (155.0, "Yes, without a doubt, but I would do it with a plan."),
    (160.6, "If you are thinking about quitting your job, save six months first."),
    (166.8, "Then jump, and do not look back."),
    (171.0, "Thank you for watching, and I will see you next week."),
]

# --- stream.mp4: 10 minutes, a game stream --------------------------------------------------
# Loud bursts in the sample: 62, 148, 237, 305, 391, 478 and 552 s (four seconds each).
STREAM: list[Line] = [
    (3.0, "Alright chat, welcome back to the stream, we are live."),
    (8.4, "Um, tonight we are going for the speed run record again."),
    (13.6, "Yesterday we lost it by, like, two seconds, which still hurts."),
    (19.8, "So let me set up the route real quick."),
    (24.0, "You know the plan: skip the first bridge, take the tunnel, save the boost."),
    (32.6, "Somebody in chat asked which car I am using tonight."),
    (37.4, "It is the same one, the blue ~Vortex, basically the best handling in the game."),
    (46.0, "Okay, three, two, one, go."),
    (50.2, "Clean start, clean start, we are already ahead of the ghost."),
    (56.8, "Here comes the tunnel jump."),
    (62.2, "Oh my god! Did you see that? We cleared the whole gap!"),
    (68.4, "That is the cleanest jump I have ever hit, chat."),
    (74.0, "Clip that, somebody clip that right now."),
    (79.6, "Okay, stay calm, stay calm, there is a lot of race left."),
    (86.0, "The second sector is where I always, um, mess it up."),
    (92.4, "You have to brake way earlier than you think."),
    (98.0, "Most people lose the run right here because they get greedy."),
    (105.2, "And we are through, half a second up on the record."),
    (111.6, "Thank you for the follow, by the way, welcome in."),
    (118.0, "Like, I cannot believe how good this run is going."),
    (124.4, "Do not say it, do not say it, I am not going to jinx it."),
    (131.0, "Okay, the ramp section, this is the scary part."),
    (137.6, "If I hit the wall here the run is dead."),
    (143.0, "Full boost, full boost, come on."),
    (148.2, "No! No way! The car flipped! What the hell was that?"),
    (154.6, "I hit the tiniest bump and the whole car went flying."),
    (160.8, "That is so unlucky, chat, that is actually painful."),
    (167.0, "Alright, alright, we reset, we go again."),
    (172.4, "Um, give me a second to breathe."),
    (180.0, "So while this loads, let me answer a few questions."),
    (185.6, "Somebody asked how many hours I have in this game."),
    (190.8, "It is about four thousand, which is, you know, a little embarrassing."),
    (198.0, "But honestly that is what it takes to be good at anything."),
    (204.4, "You do the boring practice until the hard part feels easy."),
    (211.0, "Okay, we are back in, run number two tonight."),
    (216.2, "Same route, but this time I brake before the bump."),
    (222.8, "Clean start again, the tunnel is coming up."),
    (228.4, "Nice and smooth, we are basically tied with the ghost."),
    (233.0, "Here is the ramp, do not flip, do not flip."),
    (237.2, "Yes! Yes! We made it! That is a perfect landing!"),
    (243.6, "Oh, that felt so good after the last one."),
    (249.0, "Chat is going crazy right now, I love it."),
    (255.4, "Okay, focus, the last sector is all about patience."),
    (262.0, "Do not push, just keep it clean."),
    (268.6, "We are a full second ahead now, this could be the one."),
    (275.0, "My hands are shaking, I am not going to lie."),
    (281.4, "Like, I have been chasing this record for three months."),
    (288.0, "Three months of the same track every single night."),
    (294.6, "Final corner, final corner, come on, come on."),
    (300.0, "Hold the line, hold the line."),
    (305.2, "New record! We did it! We actually did it, chat!"),
    (311.4, "I cannot believe it, three months and we finally got it!"),
    (317.8, "Thank you all so much for being here for this."),
    (324.0, "Um, okay, I need a minute, I am actually emotional."),
    (332.0, "So here is what I learned from this whole thing."),
    (337.4, "The run that worked was not the fastest one, it was the calmest one."),
    (344.8, "Every time I pushed too hard I crashed."),
    (350.0, "That is true in this game and it is basically true in life."),
    (357.2, "Alright, let us look at the replay together."),
    (362.6, "Watch the tunnel jump, look how early I let go of the boost."),
    (370.0, "That tiny detail saves almost a full second."),
    (376.4, "Nobody teaches you that, you just find it by failing a lot."),
    (383.0, "Okay, one more run for fun, no pressure this time."),
    (387.4, "Let me try the stupid shortcut everybody keeps asking about."),
    (391.4, "Whoa! It worked! The shortcut actually worked!"),
    (397.0, "That is not supposed to be possible, what is this crap?"),
    (403.4, "Okay, that is going in the highlights for sure."),
    (410.0, "Somebody tell the developers before they patch it."),
    (420.0, "நண்பர்களே, இந்த விளையாட்டு மிகவும் அருமையாக இருக்கிறது."),
    (426.4, "இன்று நாம் புதிய சாதனை படைத்தோம், மிக்க நன்றி."),
    (432.8, "அடுத்த வாரம் மீண்டும் சந்திப்போம்."),
    (440.0, "That was for my Tamil viewers, thank you for always showing up."),
    (446.6, "Okay, a couple of shout outs before we wrap up."),
    (452.0, "Thank you for the gifted subs, that is ~ridiculously generous."),
    (459.4, "And thank you to the mods for keeping chat clean tonight."),
    (466.0, "Um, last thing, let me try one silly challenge."),
    (471.2, "The whole lap in reverse, with no boost at all."),
    (478.2, "Oh no! Oh no, no, no! I am going off the cliff!"),
    (484.0, "Well, damn, that lasted about eight seconds."),
    (490.4, "Okay, okay, that was a terrible idea and I regret nothing."),
    (497.0, "So that is the stream for tonight, everybody."),
    (502.4, "We got the record, we found a shortcut, and I fell off a cliff."),
    (509.8, "Honestly, a pretty good night."),
    (514.0, "If you enjoyed it, you know what to do, hit the follow button."),
    (521.4, "I am live again on Thursday at the same time."),
    (527.0, "We are going to start a brand new game, so do not miss it."),
    (534.2, "Like, I have never played it, so it will be a disaster."),
    (540.6, "Okay, one last clip before I go."),
    (546.0, "Let me just try the ramp one more time."),
    (552.2, "Yes! Stuck the landing again! Twice in one night!"),
    (558.4, "Alright, that is the perfect note to end on."),
    (563.8, "Thank you, chat, I love you all, good night."),
    (570.0, "And remember, stay calm and keep it clean."),
    (576.4, "See you on Thursday."),
]

# --- two-speakers.mp4: 4 minutes, two people taking turns ------------------------------------
# Turns (seconds) from plan.json: left 2-13.5, right 15-26.5, left 28-39, right 40.5-49,
# left 55-69, right 70.5-84, left 85.5-96, right 97.5-110, left 116-129, right 130.5-142,
# left 143.5-154, right 155.5-168.5, left 170-181, right 187-199, left 200.5-212,
# right 213.5-225, left 226.5-237. Silences: 49-55, 110-116, 181-187.
TWO_SPEAKERS: list[Line] = [
    # left 2 to 13.5
    (2.2, "Welcome to the show. Today my guest runs a studio that makes short videos."),
    (8.0, "So, um, how did you get started with all of this?"),
    # right 15 to 26.5
    (15.2, "Thanks for having me. Honestly, it started as a hobby in my bedroom."),
    (21.0, "I had one camera, no lights, and absolutely no idea what I was doing."),
    # left 28 to 39
    (28.2, "I love that. So what changed? When did it become a real business?"),
    (34.0, "Was there, like, one moment where you knew?"),
    # right 40.5 to 49
    (40.7, "Yes. One client paid me more for one video than my whole salary."),
    (46.0, "That was the moment I quit."),
    # left 55 to 69
    (55.2, "Wow. Okay, let us talk about the work itself."),
    (59.0, "People think making a short video is easy, you know, just point and shoot."),
    (64.6, "What do they get wrong?"),
    # right 70.5 to 84
    (70.7, "Basically everything. The first three seconds decide if anyone keeps watching."),
    (76.0, "Most people open with their logo. That is the worst thing you can do."),
    (81.4, "Open with the best moment."),
    # left 85.5 to 96
    (85.7, "That is such a good point. So the hook comes first, even before the story?"),
    (91.6, "Always the hook first?"),
    # right 97.5 to 110
    (97.7, "Always. Show the ending, then explain how you got there."),
    (102.4, "And add captions, because most people watch with the sound off."),
    (107.2, "That one change doubled our views."),
    # left 116 to 129
    (116.2, "Doubled? Just from captions? That is ~incredible."),
    (120.6, "Okay, what about the boring part, um, pricing your work?"),
    (125.4, "How do you decide what to charge?"),
    # right 130.5 to 142
    (130.7, "I charge for the result, never for the hours."),
    (134.4, "If a video brings a client ten thousand dollars, one thousand is cheap."),
    (139.6, "Hours are a trap."),
    # left 143.5 to 154
    (143.7, "Hours are a trap. I am writing that down."),
    (147.2, "What is the biggest mistake you made in the first year?"),
    # right 155.5 to 168.5
    (155.7, "Saying yes to everyone. I took every job, even the bad ones."),
    (160.6, "I was tired, the work was crap, and good clients stopped calling."),
    (165.6, "Now I say no a lot."),
    # left 170 to 181
    (170.2, "Saying no is hard, though. How do you do it without losing people?"),
    (176.0, "Do you have a line you use?"),
    # right 187 to 199
    (187.2, "I do. I say, I am not the right person for this, but here is someone who is."),
    (194.2, "People remember that. They come back later with better work."),
    # left 200.5 to 212
    (200.7, "That is generous and smart at the same time."),
    (204.4, "Last question. What would you tell someone starting today?"),
    # right 213.5 to 225
    (213.7, "Make one hundred bad videos as fast as you can."),
    (217.6, "You cannot think your way to good. You have to make your way there."),
    # left 226.5 to 237
    (226.7, "Make your way there. What a great place to end."),
    (231.0, "Thank you so much for coming on the show."),
]

SCRIPTS: dict[str, tuple[str, list[Line]]] = {
    "talk": ("en", TALK),
    "stream": ("en", STREAM),
    "two-speakers": ("en", TWO_SPEAKERS),
}

#: Each sample's length in seconds (the plan's), so no line may run past the end.
SAMPLE_SECONDS: dict[str, float] = {"talk": 180.0, "stream": 600.0, "two-speakers": 240.0}

#: Stretches of the talk where nothing may be said (the no-speech test).
SILENT: dict[str, list[tuple[float, float]]] = {"talk": [(120.0, 150.0)]}
