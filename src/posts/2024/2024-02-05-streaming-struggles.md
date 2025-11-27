---
title: ADNUG Streaming struggles
date: '2024-02-05T08:00:00.000+10:30'
#image: ../../assets
tags:
- ADNUG
- Hardware
- User Groups
---

Back in 2020, the [Adelaide .NET User Group](https://www.adnug.net) switched to a virtual-only format due to pandemic restrictions. When we returned to being able to meet in person in 2021, I was keen to maintain some of the connections we'd made while we were running online, particularly with folks who joined us from interstate and overseas, as well as Adelaide people who for any reason aren't able to be in the room.

I already had a Microsoft LifeCam Studio Webcam (available as [business](https://www.amazon.com.au/Microsoft-LifeCam-Studio-for-Business/dp/B004ABO7QI?&linkCode=ll1&tag=flcdrg07-22&linkId=9b0c7f391403b7ef980af64330c85db8&language=en_AU&ref_=as_li_ss_tl) or the more pricey [regular](https://www.amazon.com.au/Microsoft-Q2F-00013-LifeCam-Studio/dp/B0096KSBB0?&linkCode=ll1&tag=flcdrg07-22&linkId=80638f5855c8f009d08668ae7b6e36a5&language=en_AU&ref_=as_li_ss_tl) models) which we'd used when video-conferencing with a remote speaker, and an [MXL AC-404](https://mxlmics.com/products/ac-404/) boundary microphone that I'd been using for a few years to record audio for the group podcast.

I had some funds put aside for the user group as well as a generous donation, so I decided to put that towards some hardware to help with streaming our meetings. I bought the following gear:

- Elgato Game Capture HD60S+ screen capture (now superseded by the [model X](https://www.amazon.com.au/Elgato-HD60-External-Capture-Card/dp/B09V1KJ3J4?th=1&linkCode=ll1&tag=flcdrg07-22&linkId=03235850b6762954dc8fa7d5dae0ed70&language=en_AU&ref_=as_li_ss_tl))
- [Rode Wireless GO II](https://www.amazon.com.au/R%C3%98DE-Ultra-compact-Dual-channel-Microphone-Microphones/dp/B08XFQ6KP9?&linkCode=ll1&tag=flcdrg07-22&linkId=dd81d961ba9000e738c536cd97b83965&language=en_AU&ref_=as_li_ss_tl) USB wireless microphones.

Both of these are well-regarded brands so I felt confident that I had selected reliable products to use. If only that was the case.

## First attempt

I did some testing at home and everything seemed to work ok and headed off to our April meeting. Having the two wireless mics would be handy as we had a presentation planned with two speakers.

I had brought two laptops - one to manage the stream and the other to present the introductory slides. But the Rode mics just refused to work. They were turned on, and the status on the receiver showed levels from the two transmitters, but nothing was showing up on the computer. A lot of fiddling, and rebooting to no avail. In the end, I had to resort to using the MXL boundary microphone. Unfortunately it didn't work as well for picking up the presenters and people on the stream were having real trouble hearing.

## Next month

The following month I'd done some further testing. I discovered that the Rode mics worked with my older laptop, but not the newer one. Not sure why, but I suspect there might be something a little odd with the USB audio on that device.

The next problem we hit was that the data projector didn't seem happy having the Elgato capture device plugged in. The display in the room we normally use is a multi-screen wall display (so not an actual projector).

![Multi-screen display with Ryan presenting in front of it](../../assets/2024/02/multi-screen-display.jpg)

We've had issues with this display in the past, even before we tried streaming. Some laptops just didn't like it (they'd display for a few seconds, then the screen would go blank). It was so bad we ended up having to do a screen share from the speaker's laptop to another laptop that was known to work with the display. I'm guessing there's some kind of signal strength issue, but it is hard to know for sure. We use a room at the University of South Australia, and the equipment probably gets a fair bit of wear and tear.

I ended up removing the capture device and not streaming that month.

## And then

In the months that followed we tried various combinations and managed to get the stream to work, but there was always the uncertainty of not knowing until the last minute whether it was going to work correctly or not.

The audio was refined a bit by making use of the [Rode Connect](https://rode.com/en/apps/rodeconnect) application to allow the mixing/muting of the two wireless mics. Much easier to mute the mics remotely, rather than having to ask the presenters to turn their mics on and off. The only downside is that the audio from Rode Connect comes into [OBS Studio](https://obsproject.com/) as a single channel, rather than two separate ones.

![Rode Connect software](../../assets/2024/02/rode-connect.png)

Working on the theory that the video signal strength might be the problem, I wondered if an HDMI signal amplifier might help. I bought a [StarTech.com HDBOOST4K 4K 60Hz HDMI Signal Booster](https://www.amazon.com.au/gp/product/B07YVYK11D?&linkCode=ll1&tag=flcdrg07-22&linkId=f3f0e942cf6e74329e8f780ef972ec37&language=en_AU&ref_=as_li_ss_tl) and tried it out. It did seem to provide a bit more stability, but that element of doubt remained. One issue that remained was that switching presenter laptops would still interrupt the signal. The Elgato seemed to need a power cycle to cope with the change.

![StarTech.com HDMI Signal booster](../../assets/2024/02/startech-hdmi-amplifier.jpg)

So we had something that worked, but it could be better.

## Next steps

Late last year I happened to be watching the live stream from [Brisbane .NET User Group's](https://www.meetup.com/en-AU/brisbane-dotnet-user-group/) meeting and was able to ask them how they manage their broadcast. From memory, they just had a large-screen TV in the room, so didn't have the challenges we experienced with room display. But also differently, rather than trying to capture video with a passthrough device like the Elgato, they use a video splitter to send the signal to both the TV and a separate capture device. The capture device they use is similar to this [HDMI to USB-C Type-C Video Capture Card](https://www.amazon.com.au/dp/B09GK7H1B5?&linkCode=ll1&tag=flcdrg07-22&linkId=72377d213818001ae42012f58a7a5805&language=en_AU&ref_=as_li_ss_tl).

So now I've bought the following to try out at the next meeting:

- [Simplecom CM412 HDMI 2 Port HDMI Duplicator](https://www.amazon.com.au/gp/product/B08H2BBH5M?&linkCode=ll1&tag=flcdrg07-22&linkId=cb28cfb1cd98d42185d61cc51a4b0afd&language=en_AU&ref_=as_li_ss_tl)
- [4K HDMI USB-C Capture Card](https://www.amazon.com.au/gp/product/B0C2HG93TG?th=1&linkCode=ll1&tag=flcdrg07-22&linkId=62d35cb2d9dbc15e956f636d2566491e&language=en_AU&ref_=as_li_ss_tl) (similar to the model above).

![Simplecom HDMI 2-port duplicator](../../assets/2024/02/simplecom-hdmi-duplicator.jpg)
![HDMI Capture Card](../../assets/2024/02/hdmi-capture-card.jpg)

I'm not sure how the HDMI splitter will go - I fear the multi-screen display might not like it either, but it's worth a shot, and they're not that expensive.

The fallback option is to drive the multi-screen display from the streaming laptop's external display. We use OBS Studio for streaming so the idea would be to map the output preview to the external display. In this way, the room display will have a constant signal, and in theory, we can switch input laptops without annoying the room display.

As an aside, one other positive is that my [latest laptop](/2023/04/new-laptop) does work correctly with the Rode mics.

## Future thoughts

One challenge that remains is having to switch between different scenes in OBS Studio and also muting and unmuting the mics. Something like an [Elgato Stream deck](https://www.amazon.com.au/Elgato-Stream-Deck-MK-2-Controller/dp/B09738CV2G?th=1&linkCode=ll1&tag=flcdrg07-22&linkId=58ea4a33106107c2dff78ac6cfae404b&language=en_AU&ref_=as_li_ss_tl) might make that easier (instead of needing to alt-tab between OBS and Rode Connect applications).

![Elgato Stream Deck Mark 2](../../assets/2024/02/elgato-stream-deck-mk2.jpg)

It would also be nice to have a better solution for in-person audience questions. We do have the MXL boundary mic, but a handheld mic would give clearer audio. Something for the wishlist!

If Rode ever updated Rode Connect to provide separate audio channels, that would be nice too.

I'll write a follow-up post down the track to report on how everything went. Check out the meeting recordings on our [YouTube channel](https://www.youtube.com/@AdelaideDotNETUserGroup) too.

(Amazon links are affiliate links.)
