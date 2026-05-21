// Sync Styler — Tool Presets
// CSS snippets available via the Tools dropdown in Settings.
// Each preset is a plain string — add new ones here and wire them up in sidepanel.js.

const SA_EZ_CHILD_CSS = `/*
 Theme Name:     SA Ez Child
 Description:    SA Ez Child Theme
 Template:       Divi
 Version:        1.0.0
*/


/* =Theme customization starts here
------------------------------------------------------- */
/* loading screen */
div .loading_box .loading_icon {
	border: none;
	content: url(https://ggsa708test.wpengine.com/wp-content/uploads/2024/04/logotest.png);
	animation: spin 2.5s linear infinite;
	width: 100px;
	height: 100px;
}
/* loading screen ends */

/* sabasic css starts */
/* sa basic demo for ggsocal plan selection page starts */
.sabasiccontainer {
	background: rgb(249 255 250 / 67%);
	border-radius: 11px;
	padding: 20px 0px 20px 12px;
	margin: 0 13px 25px;
	font-weight: 700;
	min-height: 600px;
}

.sabasiccontainer strong {
	font-weight: 700 !important;
}

.sabasiccontainer p {
	text-align: left !important;
}

div .sweti_join_now .plan_names .plan-items {
	/* background-image: url(https://ggsa708test.wpengine.com/wp-content/uploads/2024/04/unnamed-1.png) !important; */
	/* border-radius: 22px; */
	/* background-position: -71em -4em !important; */
}

div .sweti_join_now .plan-feature {
	background: none !important;
	font-family: 'Roboto';
	background-image: url(https://ggsa708test.wpengine.com/wp-content/uploads/2024/04/unnamed-1.png) !important;
	border-radius: 22px;
	background-position: -71em -4em !important;
}

div .sweti_join_now .field-header {
	margin-bottom: 20px;
}

div .sweti_join_now .plan-feature .plan-header>h3 {
	background-color: none;
	background: none;
	margin: 30px 0px 0px 0;
	border-radius: 22px 22px 0 0;
	-webkit-text-stroke: 1px black;
	color: #ffe600;
	font-size: 25px;
	font-weight: 900;
	height: 93px;
	font-family: 'Roboto';
}

div .sweti_join_now .plan-header {
	/*background: black;
	border-radius: 11px;
	padding: 10px 0px;*/
	color: #ffe600 !important;
	width: 70%;
	margin: auto auto;
	margin-bottom: 50px !important;
}

div .sweti_join_now .plan-header p {
	margin: 0 !important;
	padding: 0 !important;
}

/* sa basic demo for ggsocal plan selection page ends */
/* sa basic demo for ggsocal starts create profile page */
div .sweti_join_now .aside-inner .plan-items .plan_description {
	/* margin: 0 0 15px 0; */
	/* background: rgb(249 255 250 / 67%); */
	/* font-weight: 700; */
	/* text-align: left !important; */
	/* padding: 20px 0px 20px 12px; */
}

div#plan_data_one {
	background: rgb(249 255 250 / 67%);
	font-weight: 700;
}
/* sa basic demo for ggsocal ends create profile page */
/* sa basic demo for ggsocal starts summary page */
div#plan_data_two {
	background: rgb(249 255 250 / 67%);
	font-weight: 700;
}
/* sa basic demo for ggsocal ends summary page */
img.sabasiclogo {
	content:url(https://ggsa708test.wpengine.com/wp-content/uploads/2024/04/logotest.png);
	height:22px;
	margin: 0px 3px 0 0;
}

.sabasiclogocontainer {
    display: flex;
    justify-content: flex-start;
    align-content: center;
    flex-wrap: wrap;
}

/* sa basic demo plan selection price styles starts */
div .sweti_join_now .plan-feature p.Monthly_Rate {
    color: white;
    font-size: 71px;
}

div .sweti_join_now p.Enrollment_Fee {
    background: black;
    border-radius: 11px;
    height: 2em;
    align-content: center;
}
.sabasic_Monthly_Rate {
    display: flex;
    width: 100%;
    /* margin: 35px 0; */
    justify-content: center;
    color: white;
    font-weight: 800;
    height: 86px;
    align-items: center;
    margin-bottom: 20px;

}

span.sabasic_dollar {
    font-size: 96px;
}

span.sabasic_dollarsign {
    /* display: flex; */
    align-self: flex-start;
    font-size: 24px;
}

span.sabasic_cent {
    align-self: flex-start;
	font-size: 24px;
}
/* sa basic demo plan selection price styles ends */
/* this is for plan selection first */
div#plan_data {
	/* background: rgb(249 255 250 / 67%); */
}
/* this is for plan selection first ends */
/* sa basic css ends */
.sweti_join_now .aside-inner .plan-items {
	/* background-image: url(https://ggsa708test.wpengine.com/wp-content/uploads/2024/04/unnamed-1.png) !important; */
	/* border-radius: 0 0 22px 22px; */
	/* background-position: -71em -4em !important; */
}`;
