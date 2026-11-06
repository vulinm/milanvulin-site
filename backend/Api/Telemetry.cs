// What the API container is doing right now, as aggregates only. Everything lives in memory and resets when the
// container restarts. Nothing here records who asked, what they asked, or which path or query was requested.
public sealed class Telemetry(BuildInfo info)
{
    public const int WindowMinutes = 10;
    private const int MaxSamplesPerMinute = 512;
    private const int MaxAnswers = 200;
    private static readonly TimeSpan SnapshotTtl = TimeSpan.FromSeconds(2);

    private readonly object _gate = new();
    private readonly Minute[] _ring = Enumerable.Range(0, WindowMinutes).Select(_ => new Minute()).ToArray();
    private readonly Queue<ChatAnswer> _answers = new();
    private object? _cached;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;

    private static long CurrentMinute() => DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60;

    private Minute SlotFor(long id)
    {
        var slot = _ring[(int)(id % WindowMinutes)];
        if (slot.Id != id) slot.Reset(id);
        return slot;
    }

    // One finished API request. Called from a middleware, so it has to stay cheap.
    public void Request(double elapsedMs, int status)
    {
        lock (_gate)
        {
            var slot = SlotFor(CurrentMinute());
            slot.Requests++;
            if (status >= 500) slot.Errors++;
            if (slot.Samples.Count < MaxSamplesPerMinute) slot.Samples.Add((float)elapsedMs);
        }
    }

    // A visitor who was told the chat is busy, or who went over the per-minute limit.
    public void TurnedAway()
    {
        lock (_gate) SlotFor(CurrentMinute()).TurnedAway++;
    }

    // One finished chat answer: only its speed, never its text.
    public void Answer(long firstTokenMs, double tokensPerSecond)
    {
        if (firstTokenMs <= 0 || tokensPerSecond <= 0) return;
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            _answers.Enqueue(new ChatAnswer(now, firstTokenMs, tokensPerSecond));
            while (_answers.Count > MaxAnswers || _answers.Peek().At < now.AddMinutes(-WindowMinutes)) _answers.Dequeue();
        }
    }

    public object Snapshot(ChatService chat)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_gate)
        {
            if (_cached is not null && now - _cachedAt < SnapshotTtl) return _cached;
            _cached = Build(chat, now);
            _cachedAt = now;
            return _cached;
        }
    }

    private object Build(ChatService chat, DateTimeOffset now)
    {
        var current = now.ToUnixTimeSeconds() / 60;
        var requests = new int[WindowMinutes];
        var errors = new int[WindowMinutes];
        var p50 = new double?[WindowMinutes];
        var p95 = new double?[WindowMinutes];
        var all = new List<float>();
        var turnedAway = 0;

        for (var i = 0; i < WindowMinutes; i++)
        {
            var slot = _ring[(int)((current - (WindowMinutes - 1 - i)) % WindowMinutes)];
            if (slot.Id != current - (WindowMinutes - 1 - i)) continue; // nothing happened in that minute
            requests[i] = slot.Requests;
            errors[i] = slot.Errors;
            turnedAway += slot.TurnedAway;
            if (slot.Samples.Count > 0)
            {
                var sorted = slot.Samples.OrderBy(x => x).ToList();
                p50[i] = Round(Percentile(sorted, 0.5));
                p95[i] = Round(Percentile(sorted, 0.95));
                all.AddRange(slot.Samples);
            }
        }

        all.Sort();
        var total = requests.Sum();
        var failed = errors.Sum();
        var uptime = Math.Max(0, (now - info.StartedAt).TotalSeconds);

        // Requests per minute over the last five minutes, or over the uptime if the API started more recently.
        var recent = requests.Skip(WindowMinutes - 5).Sum();
        var perMinute = recent / Math.Clamp(uptime / 60.0, 1.0, 5.0);

        // Answers of the last ten minutes only, each with the moment it finished (never its text).
        var answers = _answers.Where(a => a.At >= now.AddMinutes(-WindowMinutes)).ToList();
        var ttft = answers.Select(a => (float)a.FirstTokenMs).OrderBy(x => x).ToList();
        var speed = answers.Select(a => (float)a.TokensPerSecond).OrderBy(x => x).ToList();

        return new
        {
            generatedAt = now,
            windowMinutes = WindowMinutes,
            startedAt = info.StartedAt,
            uptimeSeconds = (long)uptime,
            api = new
            {
                requestsPerMinute = Math.Round(perMinute, 1),
                p50Ms = all.Count > 0 ? Round(Percentile(all, 0.5)) : (double?)null,
                p95Ms = all.Count > 0 ? Round(Percentile(all, 0.95)) : (double?)null,
                errorPercent = total > 0 ? Math.Round(100.0 * failed / total, 1) : 0.0,
                requests,
                errors,
                p50,
                p95,
            },
            chat = new
            {
                enabled = chat.Enabled,
                slotsInUse = chat.SlotsInUse,
                slotsTotal = ChatService.Slots,
                turnedAway,
                ttftMedianMs = ttft.Count > 0 ? Round(Percentile(ttft, 0.5)) : (double?)null,
                tpsMedian = speed.Count > 0 ? Round(Percentile(speed, 0.5)) : (double?)null,
                answers = answers.Select(a => new { at = a.At, ttftMs = a.FirstTokenMs, tps = Math.Round(a.TokensPerSecond, 1) }),
            },
        };
    }

    // Nearest-rank percentile of an already sorted list.
    private static double Percentile(List<float> sorted, double p) =>
        sorted[Math.Clamp((int)Math.Ceiling(p * sorted.Count) - 1, 0, sorted.Count - 1)];

    private static double Round(double value) => Math.Round(value, 1);

    private sealed class Minute
    {
        public long Id = -1;
        public int Requests;
        public int Errors;
        public int TurnedAway;
        public readonly List<float> Samples = [];

        public void Reset(long id)
        {
            Id = id;
            Requests = 0;
            Errors = 0;
            TurnedAway = 0;
            Samples.Clear();
        }
    }

    private sealed record ChatAnswer(DateTimeOffset At, long FirstTokenMs, double TokensPerSecond);
}
