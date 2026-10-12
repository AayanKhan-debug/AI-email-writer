package com.email.email_writer_ab.app;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class EmailGeneratorControllerTest {

    private EmailGeneratorService emailGeneratorService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        emailGeneratorService = mock(EmailGeneratorService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new EmailGeneratorController(emailGeneratorService)).build();
    }

    @Test
    void defaultsMissingLengthToMediumAndPreservesResponseBody() throws Exception {
        when(emailGeneratorService.generateEmailReply(any()))
                .thenReturn("Generated reply");

        mockMvc.perform(post("/api/email/generate")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"Please send the report.","tone":"professional"}
                                """))
                .andExpect(status().isOk())
                .andExpect(content().string("Generated reply"));

        verify(emailGeneratorService).generateEmailReply(org.mockito.ArgumentMatchers.argThat(request ->
                "Professional".equals(request.getTone()) && "Medium".equals(request.getLength())
        ));
    }

    @Test
    void returnsClearBadRequestForUnsupportedTone() throws Exception {
        mockMvc.perform(post("/api/email/generate")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"Please send the report.","tone":"Enthusiastic","length":"Medium"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("Invalid tone. Supported values are: Professional, Friendly, Formal, Casual, Apologetic, Persuasive."));

        verifyNoInteractions(emailGeneratorService);
    }

    @Test
    void returnsClearBadRequestForUnsupportedLength() throws Exception {
        mockMvc.perform(post("/api/email/generate")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"Please send the report.","tone":"Professional","length":"Very short"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("Invalid length. Supported values are: Short, Medium, Detailed."));

        verifyNoInteractions(emailGeneratorService);
    }

    @Test
    void summarizeReturnsStructuredSummaryOnValidRequest() throws Exception {
        when(emailGeneratorService.summarizeThread("From: Alice\nHello\nFrom: Bob\nHi"))
                .thenReturn("1. Main Points: Greetings exchanged.");

        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"From: Alice\\nHello\\nFrom: Bob\\nHi"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary").value("1. Main Points: Greetings exchanged."));

        verify(emailGeneratorService).summarizeThread("From: Alice\nHello\nFrom: Bob\nHi");
    }

    @Test
    void summarizeReturnsBadRequestOnEmptyContent() throws Exception {
        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":""}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Email content must not be empty."));

        verifyNoInteractions(emailGeneratorService);
    }

    @Test
    void summarizeReturnsBadRequestOnWhitespaceContent() throws Exception {
        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"   \\n\\t  "}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Email content must not be empty."));

        verifyNoInteractions(emailGeneratorService);
    }

    @Test
    void summarizeReturnsBadRequestOnOversizedContent() throws Exception {
        String longContent = "X".repeat(EmailSummarizeRequest.MAX_EMAIL_LENGTH + 1);
        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("{\"emailContent\":\"" + longContent + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(
                        "Email content exceeds maximum allowed length of " + EmailSummarizeRequest.MAX_EMAIL_LENGTH + " characters."
                ));

        verifyNoInteractions(emailGeneratorService);
    }

    @Test
    void summarizeHandlesWebClientResponseException() throws Exception {
        when(emailGeneratorService.summarizeThread(any()))
                .thenThrow(new WebClientResponseException(HttpStatus.TOO_MANY_REQUESTS.value(), "Too Many Requests", null, null, null));

        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"Valid email content"}
                                """))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("AI Service error: 429 TOO_MANY_REQUESTS"));
    }

    @Test
    void summarizeHandlesGeneralServiceException() throws Exception {
        when(emailGeneratorService.summarizeThread(any()))
                .thenThrow(new RuntimeException("Connection timed out"));

        mockMvc.perform(post("/api/email/summarize")
                        .contentType("application/json")
                        .content("""
                                {"emailContent":"Valid email content"}
                                """))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error").value("Error: Connection timed out"));
    }
}
