using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.RateLimiting;

// Moment this process started: used to measure how long a commit took to reach production.
var startedAt = DateTimeOffset.UtcNow;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient("github", c =>
{
    c.BaseAddress = new Uri("https://api.github.com/");
    c.DefaultRequestHeaders.UserAgent.ParseAdd("milanvulin-site");
    c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
    c.Timeout = TimeSpan.FromSeconds(8);
});
builder.Services.AddSingleton(new BuildInfo(
    Sha: builder.Configuration["GIT_SHA"] ?? "dev",
    Repo: builder.Configuration["GITHUB_REPO"] ?? "vulinm/milanvulin-site",
    StartedAt: startedAt));
builder.Services.AddSingleton<DeployFeed>();
builder.Services.AddSingleton<Telemetry>();

// Local language model (optional): see ChatService. The client has no timeout because answers stream.
builder.Services.AddHttpClient("llm", c => c.Timeout = Timeout.InfiniteTimeSpan);
builder.Services.AddSingleton<ChatService>();

// GPU readings for the telemetry panel: short timeout, because the sources are on the private network.
builder.Services.AddHttpClient("gpu", c => c.Timeout = TimeSpan.FromSeconds(3));
builder.Services.AddSingleton<GpuMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<GpuMonitor>());
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = (context, _) =>
    {
        context.HttpContext.RequestServices.GetRequiredService<Telemetry>().TurnedAway();
        return ValueTask.CompletedTask;
    };
    // Per visitor: Cloudflare puts the real address in this header (the API is only reachable through it).
    o.AddPolicy("chat", ctx => RateLimitPartition.GetSlidingWindowLimiter(
        ctx.Request.Headers["CF-Connecting-IP"].ToString() is { Length: > 0 } ip ? ip : "unknown",
        _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = 8,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 4,
            QueueLimit = 0,
        }));
});

var app = builder.Build();

// Times every API request for the telemetry panel. Health checks and the telemetry endpoint itself are left out so
// they do not count as traffic, and chat answers are left out because they stream for seconds (the chat has its own
// numbers). Only the duration and the status code are kept, never the path, address or headers.
var telemetry = app.Services.GetRequiredService<Telemetry>();
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if (path.StartsWithSegments("/healthz") || path.StartsWithSegments("/api/telemetry") || path.StartsWithSegments("/api/chat"))
    {
        await next(ctx);
        return;
    }

    var started = Stopwatch.GetTimestamp();
    var status = StatusCodes.Status500InternalServerError; // stays 500 if the request throws
    try
    {
        await next(ctx);
        status = ctx.Response.StatusCode;
    }
    finally
    {
        telemetry.Request(Stopwatch.GetElapsedTime(started).TotalMilliseconds, status);
    }
});

app.UseRateLimiter();

// Internal only: the web container forwards just /api/*, so this is never reachable from outside.
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// Which commit this container was built from, and when it came up.
app.MapGet("/api/version", (BuildInfo info) => new { sha = info.Sha, repo = info.Repo, startedAt = info.StartedAt });

// Recent runs of the build workflow (public GitHub data, cached for a minute).
app.MapGet("/api/deploys", async (DeployFeed feed, CancellationToken ct) => new { runs = await feed.GetAsync(ct) });

// Shows the visitor how their own request reached this container.
// Values come from Cloudflare headers; nothing here is stored or logged.
app.MapGet("/api/trace", (HttpContext ctx, BuildInfo info) =>
{
    ctx.Response.Headers.CacheControl = "no-store";

    string? Header(string name) => ctx.Request.Headers.TryGetValue(name, out var v) ? v.ToString() : null;

    var ray = Header("CF-Ray");
    var dash = ray?.LastIndexOf('-') ?? -1;
    return new
    {
        viaCloudflare = ray is not null,
        rayId = ray,
        colo = dash >= 0 ? ray![(dash + 1)..] : null,
        country = Header("CF-IPCountry"),
        visitorIp = Header("CF-Connecting-IP"),
        scheme = ParseScheme(Header("CF-Visitor")),
        host = Header("Host"),
        container = Environment.MachineName,
        startedAt = info.StartedAt,
    };
});

// Aggregates for the Live telemetry section: one small document, kept for a couple of seconds.
app.MapGet("/api/telemetry", (HttpContext ctx, Telemetry t, ChatService chat) =>
{
    ctx.Response.Headers.CacheControl = "no-store";
    return Results.Json(t.Snapshot(chat));
});

// Chat with the local model. Status says whether the feature is configured and the model answers.
// GPU card and chat model readings; only meaningful when the chat is configured.
app.MapGet("/api/telemetry/gpu", (HttpContext ctx, ChatService chat, GpuMonitor gpu) =>
{
    if (!chat.Enabled || !gpu.Configured) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "no-store";
    return Results.Json(gpu.Snapshot());
});

app.MapGet("/api/chat/status", async (ChatService chat, CancellationToken ct) => await chat.GetStatusAsync(ct));

app.MapPost("/api/chat", async (HttpContext ctx, ChatRequest? request, ChatService chat, CancellationToken ct) =>
{
    if (!chat.Enabled) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    var problem = ChatService.Validate(request, out var history);
    if (problem is not null) return Results.BadRequest(new { error = problem });

    if (!chat.TryAcquire())
    {
        telemetry.TurnedAway();
        return Results.Json(new { error = "busy" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    try
    {
        await chat.StreamAsync(ctx, history, ct);
    }
    finally
    {
        chat.Release();
    }
    return Results.Empty;
}).RequireRateLimiting("chat");

// Says in the log whether the chat model got its profile text, so an update can be verified.
if (ChatPrompt.Profile is { } profile)
    app.Logger.LogInformation("Chat profile: loaded, {Chars} characters", profile.Length);
else
    app.Logger.LogWarning("Chat profile: missing or empty at {Path}; the chat stays off", ChatPrompt.ProfilePath);

app.Run();

static string? ParseScheme(string? cfVisitor)
{
    if (string.IsNullOrEmpty(cfVisitor)) return null;
    try { return JsonNode.Parse(cfVisitor)?["scheme"]?.GetValue<string>(); }
    catch (JsonException) { return null; }
}

public sealed record BuildInfo(string Sha, string Repo, DateTimeOffset StartedAt);

public sealed record DeployRun(
    string Sha,
    string Message,
    string Status,
    string? Conclusion,
    DateTimeOffset Started,
    DateTimeOffset Updated,
    string Url);

// Fetches the latest runs of build.yml from the public GitHub API. At most one request a minute,
// and when GitHub is unavailable the last good answer keeps being served.
public sealed class DeployFeed(IHttpClientFactory http, BuildInfo info, ILogger<DeployFeed> log)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _fetched = DateTimeOffset.MinValue;
    private IReadOnlyList<DeployRun> _runs = [];

    public async Task<IReadOnlyList<DeployRun>> GetAsync(CancellationToken ct)
    {
        if (DateTimeOffset.UtcNow - _fetched < Ttl) return _runs;

        await _gate.WaitAsync(ct);
        try
        {
            if (DateTimeOffset.UtcNow - _fetched < Ttl) return _runs;
            try
            {
                _runs = await FetchAsync(ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or FormatException)
            {
                log.LogWarning(e, "Could not fetch workflow runs from GitHub");
            }
            _fetched = DateTimeOffset.UtcNow; // also after a failure, so a GitHub outage is retried once a minute
        }
        finally
        {
            _gate.Release();
        }
        return _runs;
    }

    private async Task<IReadOnlyList<DeployRun>> FetchAsync(CancellationToken ct)
    {
        var client = http.CreateClient("github");
        var body = await client.GetStringAsync(
            $"repos/{info.Repo}/actions/workflows/build.yml/runs?branch=main&per_page=10", ct);
        var items = JsonNode.Parse(body)?["workflow_runs"]?.AsArray() ?? new JsonArray();

        var list = new List<DeployRun>();
        foreach (var r in items)
        {
            if (r is null) continue;
            var started = Time(r["run_started_at"]) ?? Time(r["created_at"]);
            var updated = Time(r["updated_at"]);
            if (started is null || updated is null) continue;

            var message = (Text(r["head_commit"]?["message"]) ?? "").Split('\n')[0];
            if (message.Length > 100) message = message[..100] + "…";

            list.Add(new DeployRun(
                Sha: Text(r["head_sha"]) ?? "",
                Message: message,
                Status: Text(r["status"]) ?? "unknown",
                Conclusion: Text(r["conclusion"]),
                Started: started.Value,
                Updated: updated.Value,
                Url: Text(r["html_url"]) ?? ""));
        }
        return list;
    }

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static DateTimeOffset? Time(JsonNode? n) =>
        Text(n) is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)
            ? t
            : null;
}
