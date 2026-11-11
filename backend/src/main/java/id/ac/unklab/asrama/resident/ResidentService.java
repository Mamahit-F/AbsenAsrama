package id.ac.unklab.asrama.resident;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.resident.ResidentDtos.*;
import id.ac.unklab.asrama.security.SecurityUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ResidentService {

    private final ResidentRepository residentRepository;
    private final SecurityUtils securityUtils;

    public ResidentService(ResidentRepository residentRepository, SecurityUtils securityUtils) {
        this.residentRepository = residentRepository;
        this.securityUtils = securityUtils;
    }

    @Transactional(readOnly = true)
    public ResidentProfileDto getMyResidentProfile() {
        UUID residentId = securityUtils.getCurrentResidentId();
        if (residentId == null) {
            throw BusinessException.badRequest("NOT_A_RESIDENT", "Akun Anda bukan akun PENGHUNI");
        }
        return getResidentById(residentId);
    }

    @Transactional(readOnly = true)
    public ResidentProfileDto getResidentById(UUID residentId) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return residentRepository.findById(residentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Data penghuni tidak ditemukan"));
    }

    @Transactional(readOnly = true)
    public List<ResidentProfileDto> listResidents(
            ResidentStatus status,
            ResidenceCategory category,
            String search,
            Integer limit,
            Integer offset
    ) {
        return residentRepository.searchResidents(status, category, search, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<ResidentProfileDto> listResidents(ResidentStatus status, ResidenceCategory category, String search) {
        return listResidents(status, category, search, null, null);
    }

    @Transactional
    public ConsentDto recordConsent(UUID residentId, ConsentRequest request) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        residentRepository.findById(residentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Data penghuni tidak ditemukan"));
        return residentRepository.insertConsent(residentId, request.consentVersion(), request.evidencePath());
    }

    @Transactional(readOnly = true)
    public List<ConsentDto> getConsents(UUID residentId) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return residentRepository.findConsentsByResident(residentId);
    }

    @Transactional
    public void revokeConsent(UUID residentId) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        residentRepository.revokeActiveConsent(residentId);
    }

    @Transactional(readOnly = true)
    public List<EmergencyContactDto> getEmergencyContacts(UUID residentId) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return residentRepository.findEmergencyContacts(residentId);
    }

    @Transactional
    public EmergencyContactDto addEmergencyContact(UUID residentId, EmergencyContactRequest request) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return residentRepository.insertEmergencyContact(
                residentId,
                request.fullName(),
                request.relationship(),
                request.phone(),
                request.isPrimary()
        );
    }
}
