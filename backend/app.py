"""BudSense.AI prototype FastAPI application."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="BudSense.AI Prototype API",
    description=(
        "Prototype endpoints for the BudSense.AI intelligent budtender platform."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Strain(BaseModel):
    name: str
    genetics: str
    dominant_terpenes: List[str] = Field(default_factory=list)
    effects: List[str] = Field(default_factory=list)
    thc_percent: float = Field(..., ge=0)
    cbd_percent: float = Field(..., ge=0)
    aroma: List[str] = Field(default_factory=list)
    clean_badge: bool = False
    last_verified: datetime
    lab_report_url: Optional[str]
    notes: Optional[str]


class StrainSearchResponse(BaseModel):
    query: str
    results: List[Strain]


class COAAnalyte(BaseModel):
    name: str
    value_ppm: float
    limit_ppm: float

    @property
    def is_flagged(self) -> bool:
        return self.value_ppm > self.limit_ppm


class COAIngestRequest(BaseModel):
    strain_name: str
    lab_name: str
    source_url: str
    collected_at: datetime
    analytes: List[COAAnalyte] = Field(default_factory=list)


class COAIngestResponse(BaseModel):
    strain_name: str
    lab_name: str
    source_url: str
    flagged_analytes: List[str] = Field(default_factory=list)
    clean: bool
    ingested_at: datetime


class ReserveItem(BaseModel):
    product_id: str
    quantity: float = Field(gt=0)
    unit: str = "g"


class ReserveRequest(BaseModel):
    tenant_id: str = Field(..., alias="tenantId")
    customer_name: str
    contact_method: str
    contact_value: str
    pickup_preference: str = Field(default="in-store")
    items: List[ReserveItem]


class ReserveResponse(BaseModel):
    reservation_id: str
    status: str
    message: str


class NotificationRequest(BaseModel):
    channel: str
    recipient: str
    message: str
    metadata: Optional[dict] = None


class NotificationResponse(BaseModel):
    status: str
    detail: str


class GeoPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class MenuItem(BaseModel):
    sku: str
    name: str
    category: str
    thc_percent: float
    cbd_percent: float
    price: float
    unit: str = "g"
    deal: Optional[str] = None
    in_stock: bool = True
    tags: List[str] = Field(default_factory=list)


class DispensaryMenu(BaseModel):
    dispensary_id: str
    dispensary_name: str
    distance_miles: float
    last_synced: datetime
    items: List[MenuItem]
    loyalty_deals: List[str] = Field(default_factory=list)
    lounge_ready: bool = False


class MenuSyncRequest(BaseModel):
    location: GeoPoint
    radius_miles: float = Field(default=60, gt=0, le=120)
    categories: List[str] = Field(default_factory=list)


class MenuSyncResponse(BaseModel):
    synced_at: datetime
    radius_miles: float
    menus: List[DispensaryMenu]


class DealApplicationRequest(BaseModel):
    dispensary_id: str
    vibe: Optional[str] = None
    prefer_clean: bool = True
    favorite_terpenes: List[str] = Field(default_factory=list)


class DealApplicationResponse(BaseModel):
    dispensary_id: str
    applied_items: List[MenuItem]
    connection_notes: List[str]
    lounge_recommendations: List[str]


class SocialProfile(BaseModel):
    profile_id: str
    display_name: str
    favorite_strains: List[str]
    current_smoke: Optional[str] = None
    lounge_homebase: Optional[str] = None
    vibes: List[str] = Field(default_factory=list)
    bio: Optional[str] = None


class SocialPost(BaseModel):
    post_id: str
    author_id: str
    author_name: str
    content: str
    featured_strain: Optional[str] = None
    vibes: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    media_url: Optional[str] = None
    engagement: dict = Field(default_factory=lambda: {"likes": 0, "comments": 0})


class SocialFeedResponse(BaseModel):
    posts: List[SocialPost]
    next_refresh: datetime


class CreatePostRequest(BaseModel):
    author_id: str
    content: str
    featured_strain: Optional[str] = None
    vibes: List[str] = Field(default_factory=list)
    media_url: Optional[str] = None


class BuddyMatchRequest(BaseModel):
    profile_id: str
    desired_vibes: List[str] = Field(default_factory=list)
    preferred_strains: List[str] = Field(default_factory=list)


class BuddyMatchResponse(BaseModel):
    profile_id: str
    matches: List[SocialProfile]
    lounge_suggestions: List[str]


class SocialDailyRefreshRequest(BaseModel):
    highlight_strains: List[str] = Field(default_factory=list)


class SocialDailyRefreshResponse(BaseModel):
    refreshed_at: datetime
    new_posts: List[SocialPost]
    trending_tags: List[str]


MOCK_STRAINS: List[Strain] = [
    Strain(
        name="Gelato 41",
        genetics="Sunset Sherbet x Thin Mint GSC",
        dominant_terpenes=["limonene", "caryophyllene", "linalool"],
        effects=["creative", "uplifted", "relaxed"],
        thc_percent=27.8,
        cbd_percent=0.1,
        aroma=["sweet", "dessert", "berry"],
        clean_badge=True,
        last_verified=datetime(2024, 1, 11, 12, 0, 0),
        lab_report_url="https://labs.example.com/gelato41.pdf",
        notes="Fresh drop — zero residual solvents detected.",
    ),
    Strain(
        name="Zkittlez",
        genetics="Grape Ape x Grapefruit",
        dominant_terpenes=["humulene", "limonene", "myrcene"],
        effects=["happy", "euphoric", "focused"],
        thc_percent=24.2,
        cbd_percent=0.2,
        aroma=["candy", "tropical", "citrus"],
        clean_badge=True,
        last_verified=datetime(2024, 1, 5, 9, 30, 0),
        lab_report_url="https://labs.example.com/zkittlez.pdf",
        notes="Drop alert! Reserve before the lounge sells out.",
    ),
    Strain(
        name="Blue Dream",
        genetics="Blueberry x Haze",
        dominant_terpenes=["myrcene", "pinene", "caryophyllene"],
        effects=["relaxed", "uplifted", "creative"],
        thc_percent=21.5,
        cbd_percent=0.3,
        aroma=["sweet", "berry", "earthy"],
        clean_badge=False,
        last_verified=datetime(2023, 12, 28, 16, 45, 0),
        lab_report_url="https://labs.example.com/bluedream.pdf",
        notes="COA under review for trace pesticides — standby for update.",
    ),
]


MOCK_MENU_DATA: List[dict] = [
    {
        "dispensary_id": "oakland-botanica",
        "dispensary_name": "Oakland Botanica",
        "distance_miles": 12.4,
        "last_synced": datetime(2024, 1, 14, 9, 30, 0),
        "lounge_ready": True,
        "loyalty_deals": [
            "Wake-n-Bake BOGO before 11am",
            "Terp Titans members save 15% on solventless",
        ],
        "items": [
            {
                "sku": "OB-GEL41-35",
                "name": "Gelato 41 Eighth",
                "category": "Flower",
                "thc_percent": 32.4,
                "cbd_percent": 0.1,
                "price": 54.0,
                "unit": "eighth",
                "deal": None,
                "tags": ["dessert", "creative", "clean-cert"],
            },
            {
                "sku": "OB-PAPAYA-1G",
                "name": "Papaya Live Rosin",
                "category": "Concentrate",
                "thc_percent": 78.2,
                "cbd_percent": 0.2,
                "price": 65.0,
                "unit": "gram",
                "deal": "Pair with Guava Kush pre-rolls for $20 off",
                "tags": ["solventless", "lounge-ready"],
            },
        ],
    },
    {
        "dispensary_id": "mission-haze",
        "dispensary_name": "Mission Haze Club",
        "distance_miles": 4.3,
        "last_synced": datetime(2024, 1, 14, 10, 15, 0),
        "lounge_ready": True,
        "loyalty_deals": [
            "Happy Hour 4:20pm - 6pm 20% off carts",
            "Lounge buddies get free mocktails on Thursdays",
        ],
        "items": [
            {
                "sku": "MH-ZKIT-7G",
                "name": "Zkittlez Small Batch",
                "category": "Flower",
                "thc_percent": 28.7,
                "cbd_percent": 0.3,
                "price": 120.0,
                "unit": "quarter",
                "deal": "Reserve with a lounge table and get infused gummies", 
                "tags": ["party", "fruit", "lounge"],
            },
            {
                "sku": "MH-LIMON-10PK",
                "name": "Limonene Lift Gummies",
                "category": "Edible",
                "thc_percent": 5.0,
                "cbd_percent": 2.0,
                "price": 28.0,
                "unit": "pack",
                "deal": None,
                "tags": ["microdose", "daytime"],
            },
        ],
    },
    {
        "dispensary_id": "berkeley-bloom",
        "dispensary_name": "Berkeley Bloom Lounge",
        "distance_miles": 18.9,
        "last_synced": datetime(2024, 1, 13, 21, 0, 0),
        "lounge_ready": False,
        "loyalty_deals": [
            "Students save 10% with ID",
            "Bring-a-buddy: both get terp flights",
        ],
        "items": [
            {
                "sku": "BB-BLUE-35",
                "name": "Blue Dream Sun Grown",
                "category": "Flower",
                "thc_percent": 22.1,
                "cbd_percent": 0.4,
                "price": 42.0,
                "unit": "eighth",
                "deal": "Bundle with Dreamy cart for $10 off",
                "tags": ["classic", "creative"],
            },
            {
                "sku": "BB-ICE-500",
                "name": "Ice Cream Cake Vape",
                "category": "Cartridge",
                "thc_percent": 85.0,
                "cbd_percent": 0.0,
                "price": 48.0,
                "unit": "half-gram",
                "deal": None,
                "tags": ["dessert", "evening"],
            },
        ],
    },
]


SOCIAL_PROFILES: List[SocialProfile] = [
    SocialProfile(
        profile_id="ashley-terp-queen",
        display_name="Ashley Terp Queen",
        favorite_strains=["Gelato 41", "Papaya", "RS11"],
        current_smoke="Gelato 41",
        lounge_homebase="Mission Haze Club",
        vibes=["creative", "gallery-hop", "dessert terp"],
        bio="Designing by day, curating the loudest terp flights by night.",
    ),
    SocialProfile(
        profile_id="lofi-lounger",
        display_name="LoFi Lounger",
        favorite_strains=["Blue Dream", "Super Lemon Haze"],
        current_smoke="Blue Dream",
        lounge_homebase="Berkeley Bloom Lounge",
        vibes=["chill", "vinyl", "sunset-sesh"],
        bio="Host of Sunday mellow sessions — bring your best playlist.",
    ),
    SocialProfile(
        profile_id="caryophyllene-king",
        display_name="Caryophyllene King",
        favorite_strains=["Zkittlez", "Gary Payton"],
        current_smoke="Zkittlez",
        lounge_homebase="Oakland Botanica",
        vibes=["party", "game-night", "neo-soul"],
        bio="Always scouting funky terps + hoops highlights.",
    ),
]


SOCIAL_POSTS: List[SocialPost] = [
    SocialPost(
        post_id="post-001",
        author_id="ashley-terp-queen",
        author_name="Ashley Terp Queen",
        content="Tapped into a new batch of Gelato 41 — zero residuals, terps hitting like candy clouds.",
        featured_strain="Gelato 41",
        vibes=["creative", "dessert"],
        media_url="https://images.example.com/gelato41-drop.jpg",
        engagement={"likes": 128, "comments": 12},
    ),
    SocialPost(
        post_id="post-002",
        author_id="lofi-lounger",
        author_name="LoFi Lounger",
        content="Hosting a vinyl + vapor session this Friday. Bring your fave sativa and good vibes.",
        featured_strain="Blue Dream",
        vibes=["chill", "community"],
        media_url="https://images.example.com/lofi-lounge.jpg",
        engagement={"likes": 86, "comments": 9},
    ),
    SocialPost(
        post_id="post-003",
        author_id="caryophyllene-king",
        author_name="Caryophyllene King",
        content="Mission Haze just loaded a Zkittlez cart deal — meeting up for a lounge run tonight.",
        featured_strain="Zkittlez",
        vibes=["party", "night-out"],
        engagement={"likes": 64, "comments": 6},
    ),
]


def _menus_within_radius(radius_miles: float) -> List[DispensaryMenu]:
    now = datetime.utcnow()
    refreshed: List[DispensaryMenu] = []
    for record in MOCK_MENU_DATA:
        if record["distance_miles"] <= radius_miles:
            record["last_synced"] = now
            refreshed.append(DispensaryMenu(**record))
    return refreshed


def _apply_deals_to_menu(menu: DispensaryMenu, request: DealApplicationRequest) -> List[MenuItem]:
    applied: List[MenuItem] = []
    for item in menu.items:
        deal_text = item.deal
        tags_text = " ".join(item.tags).lower()
        if request.prefer_clean and "clean" in tags_text:
            deal_text = deal_text or "Clean badge verified — add to lounge flight"
        if request.favorite_terpenes:
            terp_hits = [
                terp for terp in request.favorite_terpenes if terp.lower() in tags_text
            ]
            if terp_hits:
                deal_text = deal_text or f"Stacks with terp crush: {', '.join(terp_hits)}"
        if request.vibe and request.vibe.lower() in tags_text:
            deal_text = deal_text or f"Dialed for {request.vibe} nights"
        data = item.dict()
        data["deal"] = deal_text
        applied.append(MenuItem(**data))
    return applied


def _get_menu_by_id(dispensary_id: str) -> Optional[DispensaryMenu]:
    for record in MOCK_MENU_DATA:
        if record["dispensary_id"] == dispensary_id:
            return DispensaryMenu(**record)
    return None


@app.get("/strains/search", response_model=StrainSearchResponse)
def search_strains(q: str = Query("", description="Search terms for strain name or effects")) -> StrainSearchResponse:
    """Return a filtered list of mock strains.

    In a production build this would call into Watson Discovery + MongoDB Atlas
    for hybrid retrieval.
    """
    normalized_query = q.strip().lower()
    if not normalized_query:
        results = MOCK_STRAINS
    else:
        results = [
            strain
            for strain in MOCK_STRAINS
            if normalized_query in strain.name.lower()
            or any(normalized_query in terp.lower() for terp in strain.dominant_terpenes)
            or any(normalized_query in effect.lower() for effect in strain.effects)
        ]
    return StrainSearchResponse(query=q, results=results)


@app.post("/menus/sync", response_model=MenuSyncResponse)
def sync_menus(payload: MenuSyncRequest) -> MenuSyncResponse:
    menus = _menus_within_radius(payload.radius_miles)
    if payload.categories:
        categories = {category.lower() for category in payload.categories}
        filtered: List[DispensaryMenu] = []
        for menu in menus:
            items = [
                item for item in menu.items if item.category.lower() in categories
            ]
            if items:
                filtered.append(menu.copy(update={"items": items}))
        menus = filtered
    return MenuSyncResponse(
        synced_at=datetime.utcnow(),
        radius_miles=payload.radius_miles,
        menus=menus,
    )


@app.get("/menus/nearby", response_model=MenuSyncResponse)
def list_nearby_menus(
    lat: float = Query(..., description="Latitude for the search origin"),
    lon: float = Query(..., description="Longitude for the search origin"),
    radius_miles: float = Query(60, gt=0, le=120, description="Radius in miles"),
    categories: Optional[str] = Query(
        None, description="Comma separated categories to filter (e.g. Flower,Edible)"
    ),
) -> MenuSyncResponse:
    del lat, lon  # Placeholder until hooked to a geo lookup or mapping service.
    menus = _menus_within_radius(radius_miles)
    if categories:
        requested = {
            category.strip().lower()
            for category in categories.split(",")
            if category.strip()
        }
        if requested:
            filtered: List[DispensaryMenu] = []
            for menu in menus:
                items = [
                    item for item in menu.items if item.category.lower() in requested
                ]
                if items:
                    filtered.append(menu.copy(update={"items": items}))
            menus = filtered
    return MenuSyncResponse(
        synced_at=datetime.utcnow(),
        radius_miles=radius_miles,
        menus=menus,
    )


@app.post("/lounge/deals/apply", response_model=DealApplicationResponse)
def apply_lounge_deals(payload: DealApplicationRequest) -> DealApplicationResponse:
    menu = _get_menu_by_id(payload.dispensary_id)
    if not menu:
        raise HTTPException(status_code=404, detail="Dispensary menu not found")

    applied_items = _apply_deals_to_menu(menu, payload)

    connection_notes: List[str] = []
    for profile in SOCIAL_PROFILES:
        vibe_overlap = False
        if payload.vibe:
            vibe_overlap = any(
                payload.vibe.lower() in vibe.lower() for vibe in profile.vibes
            )
        terp_overlap = False
        if payload.favorite_terpenes:
            terp_overlap = any(
                terp.lower() in (profile.current_smoke or "").lower()
                for terp in payload.favorite_terpenes
            )
        if vibe_overlap or terp_overlap:
            connection_notes.append(
                f"{profile.display_name} is seshing on {profile.current_smoke} at {profile.lounge_homebase}."
            )
        if len(connection_notes) >= 3:
            break

    lounge_recommendations = [
        f"{menu.dispensary_name} perks: {', '.join(menu.loyalty_deals[:2])}"
        if menu.loyalty_deals
        else f"{menu.dispensary_name} — ask staff for nightly specials"
    ]
    if menu.lounge_ready:
        lounge_recommendations.append("Lounge ready: reserve a table straight from chat.")

    return DealApplicationResponse(
        dispensary_id=payload.dispensary_id,
        applied_items=applied_items,
        connection_notes=connection_notes,
        lounge_recommendations=lounge_recommendations,
    )


@app.get("/social/profiles", response_model=List[SocialProfile])
def list_social_profiles() -> List[SocialProfile]:
    return SOCIAL_PROFILES


@app.get("/social/feed", response_model=SocialFeedResponse)
def get_social_feed() -> SocialFeedResponse:
    posts = sorted(SOCIAL_POSTS, key=lambda post: post.created_at, reverse=True)
    next_refresh = datetime.utcnow().replace(hour=23, minute=59, second=0, microsecond=0)
    return SocialFeedResponse(posts=posts, next_refresh=next_refresh)


@app.post("/social/posts", response_model=SocialPost)
def create_social_post(payload: CreatePostRequest) -> SocialPost:
    author = next(
        (profile for profile in SOCIAL_PROFILES if profile.profile_id == payload.author_id),
        None,
    )
    if not author:
        raise HTTPException(status_code=404, detail="Author profile not found")

    post = SocialPost(
        post_id=f"post-{len(SOCIAL_POSTS) + 1:03d}-{int(datetime.utcnow().timestamp())}",
        author_id=author.profile_id,
        author_name=author.display_name,
        content=payload.content,
        featured_strain=payload.featured_strain,
        vibes=payload.vibes or author.vibes,
        media_url=payload.media_url,
        engagement={"likes": 0, "comments": 0},
    )
    SOCIAL_POSTS.append(post)
    author.current_smoke = payload.featured_strain or author.current_smoke
    return post


@app.post("/social/buddies/match", response_model=BuddyMatchResponse)
def match_lounge_buddies(payload: BuddyMatchRequest) -> BuddyMatchResponse:
    profile = next(
        (candidate for candidate in SOCIAL_PROFILES if candidate.profile_id == payload.profile_id),
        None,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    matches: List[SocialProfile] = []
    for candidate in SOCIAL_PROFILES:
        if candidate.profile_id == profile.profile_id:
            continue
        vibe_overlap = any(
            vibe.lower() in {v.lower() for v in candidate.vibes}
            for vibe in (payload.desired_vibes or profile.vibes)
        )
        strain_overlap = any(
            strain.lower() in {s.lower() for s in candidate.favorite_strains}
            for strain in (payload.preferred_strains or profile.favorite_strains)
        )
        if vibe_overlap or strain_overlap:
            matches.append(candidate)
        if len(matches) >= 3:
            break

    lounge_suggestions = list(
        {
            candidate.lounge_homebase
            for candidate in matches
            if candidate.lounge_homebase
        }
    )

    return BuddyMatchResponse(
        profile_id=payload.profile_id,
        matches=matches,
        lounge_suggestions=lounge_suggestions,
    )


@app.post("/social/daily-refresh", response_model=SocialDailyRefreshResponse)
def social_daily_refresh(payload: SocialDailyRefreshRequest) -> SocialDailyRefreshResponse:
    highlight = payload.highlight_strains or [strain.name for strain in MOCK_STRAINS[:2]]
    new_posts: List[SocialPost] = []
    for strain_name in highlight:
        matched_profile = SOCIAL_PROFILES[0]
        if highlight.index(strain_name) < len(SOCIAL_PROFILES):
            matched_profile = SOCIAL_PROFILES[highlight.index(strain_name)]
        post = SocialPost(
            post_id=f"post-{len(SOCIAL_POSTS) + 1:03d}-{int(datetime.utcnow().timestamp())}",
            author_id=matched_profile.profile_id,
            author_name=matched_profile.display_name,
            content=f"Daily drop: {strain_name} is live with fresh COAs. Who's rolling through tonight?",
            featured_strain=strain_name,
            vibes=list({*matched_profile.vibes, "daily-drop"}),
            engagement={"likes": 0, "comments": 0},
        )
        SOCIAL_POSTS.append(post)
        matched_profile.current_smoke = strain_name
        new_posts.append(post)

    vibe_counts = {}
    for post in SOCIAL_POSTS:
        for vibe in post.vibes:
            vibe_counts[vibe] = vibe_counts.get(vibe, 0) + 1
    trending_tags = [tag for tag, _ in sorted(vibe_counts.items(), key=lambda item: item[1], reverse=True)[:5]]

    return SocialDailyRefreshResponse(
        refreshed_at=datetime.utcnow(),
        new_posts=new_posts,
        trending_tags=trending_tags,
    )


@app.post("/ingest_coa", response_model=COAIngestResponse)
def ingest_coa(payload: COAIngestRequest) -> COAIngestResponse:
    """Mock COA ingestion that flags analytes above threshold."""
    flagged = [
        analyte.name
        for analyte in payload.analytes
        if analyte.value_ppm > analyte.limit_ppm
    ]
    return COAIngestResponse(
        strain_name=payload.strain_name,
        lab_name=payload.lab_name,
        source_url=payload.source_url,
        flagged_analytes=flagged,
        clean=len(flagged) == 0,
        ingested_at=datetime.utcnow(),
    )


@app.post("/orders/reserve", response_model=ReserveResponse)
def reserve_order(payload: ReserveRequest) -> ReserveResponse:
    if not payload.items:
        raise HTTPException(status_code=400, detail="Reservation requires at least one item")

    reservation_id = f"RSV-{datetime.utcnow():%Y%m%d%H%M%S}"
    message = (
        "Reservation locked and loaded. Expect a ping once the staff confirms pickup."
    )
    return ReserveResponse(reservation_id=reservation_id, status="pending", message=message)


@app.post("/notify", response_model=NotificationResponse)
def send_notification(payload: NotificationRequest) -> NotificationResponse:
    """Mock notification sender.

    In production this would fan out to Twilio, SendGrid, Meta, etc.
    """
    supported_channels = {"sms", "email", "push", "voice"}
    if payload.channel not in supported_channels:
        raise HTTPException(status_code=422, detail="Unsupported channel")

    detail = (
        f"Queued {payload.channel} notification for {payload.recipient}."
    )
    return NotificationResponse(status="queued", detail=detail)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


__all__ = [
    "app",
]
